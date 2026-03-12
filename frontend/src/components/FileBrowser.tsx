import React from "react";
import {
  listDirectory,
  FileInfo,
  DirectoryListing,
  downloadFile,
  uploadTargz,
  deletePath,
  mkdir,
  touchPath,
  renamePath,
  chmodPath,
  uploadBatch,
} from "../lib/api";
import { useApp } from "../context/AppContext";
import type { NetworkProfile } from "../context/AppContext";
import { useToast } from "./Toast";
import { collectDroppedFiles, createTarGzArchive, snapshotDropPayload } from "../lib/upload";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function calculateTotalBytes(files: Array<{ file: File; path: string }>): number {
  return files.reduce((sum, item) => sum + item.file.size, 0);
}

function permissionsToOctal(permissions: string): string {
  if (permissions.length !== 10) return permissions;
  const groups = [permissions.slice(1, 4), permissions.slice(4, 7), permissions.slice(7, 10)];
  return groups.map(group => {
    let value = 0;
    if (group[0] === 'r') value += 4;
    if (group[1] === 'w') value += 2;
    if (group[2] === 'x') value += 1;
    return value;
  }).join('');
}

type TreeNode = {
  name: string;
  path: string;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
};

type FileBrowserProps = {
  sessionId: string;
  isDark: boolean;
  currentDir?: string;
  onFileSelect?: (path: string | null) => void;
  networkProfile?: NetworkProfile;
};

type UploadStats = {
  current: number;
  total: number;
  uploadedBytes: number;
  totalBytes: number;
};

type DownloadStats = {
  current: number;
  total: number;
  loadedBytes: number;
  totalBytes: number;
  phase: "compressing" | "transferring";
  targetName: string;
};

type UploadFailureItem = {
  file: File;
  path: string;
  reason: string;
};

const INITIAL_UPLOAD_STATS: UploadStats = {
  current: 0,
  total: 0,
  uploadedBytes: 0,
  totalBytes: 0,
};

function calculatePercent(loaded: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, (loaded / total) * 100);
}

type DirectoryCacheItem = {
  fetchedAt: number;
  result: DirectoryListing;
};

function createRootTree(): TreeNode[] {
  return [{ name: "/", path: "/", expanded: true, loaded: false }];
}

export function FileBrowser({ sessionId, isDark, currentDir, onFileSelect, networkProfile }: FileBrowserProps) {
  const { networkProfile: globalNetworkProfile, language } = useApp();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const effectiveNetworkProfile = networkProfile ?? globalNetworkProfile;
  const directoryCacheTtlMs =
    effectiveNetworkProfile === "poor" ? 12000 : effectiveNetworkProfile === "degraded" ? 6000 : 3000;
  const currentDirDebounceMs =
    effectiveNetworkProfile === "poor" ? 800 : effectiveNetworkProfile === "degraded" ? 350 : 120;
  const uploadBatchConcurrent =
    effectiveNetworkProfile === "poor" ? 1 : effectiveNetworkProfile === "degraded" ? 2 : 4;
  const [tree, setTree] = React.useState<TreeNode[]>(() => createRootTree());
  const [selectedPath, setSelectedPath] = React.useState<string>("/");
  const [pathInput, setPathInput] = React.useState<string>("/");
  const [files, setFiles] = React.useState<FileInfo[]>([]);
  const [treeLoading, setTreeLoading] = React.useState<string | null>(null);
  const [filesLoading, setFilesLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [compress, setCompress] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<FileInfo | null>(null);
  const [selectedFiles, setSelectedFiles] = React.useState<Set<string>>(new Set());
  const [downloading, setDownloading] = React.useState(false);
  const [downloadStats, setDownloadStats] = React.useState<DownloadStats | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<string[]>([]);
  const uploadCancelledRef = React.useRef(false);
  const [uploadStats, setUploadStats] = React.useState<UploadStats>(INITIAL_UPLOAD_STATS);
  const [lastUploadFailures, setLastUploadFailures] = React.useState<UploadFailureItem[]>([]);
  const [uploadStage, setUploadStage] = React.useState<"batch" | "compressing" | "compressed_upload">("batch");
  const { push } = useToast();
  const lastClickTime = React.useRef<number>(0);
  const lastClickPath = React.useRef<string>("");
  const [colWidths, setColWidths] = React.useState({ size: 80, permissions: 100, owner: 80, modified: 120 });
  const [resizingCol, setResizingCol] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; type: 'blank' | 'single' | 'multiple'; files: FileInfo[] } | null>(null);
  const [dialog, setDialog] = React.useState<{ type: "mkdir" | "touch" | "rename" | "chmod"; files: FileInfo[] } | null>(null);
  const [dialogInput, setDialogInput] = React.useState("");
  const [chmodRecursive, setChmodRecursive] = React.useState(false);
  const [chmodLoading, setChmodLoading] = React.useState(false);
  const directoryCacheRef = React.useRef<Map<string, DirectoryCacheItem>>(new Map());
  const treeRef = React.useRef<TreeNode[]>(tree);
  const selectedPathRef = React.useRef<string>(selectedPath);

  React.useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  React.useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const normalizePath = React.useCallback((path: string): string => {
    const trimmed = path.trim();
    if (!trimmed || trimmed === "/") return "/";
    return trimmed.replace(/\/+$/, "") || "/";
  }, []);

  const getDirectoryListing = React.useCallback(
    async (
      path: string,
      options?: { preferCache?: boolean; forceRefresh?: boolean }
    ): Promise<DirectoryListing> => {
      const normalizedPath = normalizePath(path);
      const now = Date.now();
      const cached = directoryCacheRef.current.get(normalizedPath);
      const canUseCache = options?.preferCache !== false && !options?.forceRefresh;

      if (canUseCache && cached && now - cached.fetchedAt < directoryCacheTtlMs) {
        return cached.result;
      }

      const result = await listDirectory(sessionId, normalizedPath);
      directoryCacheRef.current.set(normalizedPath, { fetchedAt: now, result });
      if (directoryCacheRef.current.size > 200) {
        const oldestKey = directoryCacheRef.current.keys().next().value as string | undefined;
        if (oldestKey) {
          directoryCacheRef.current.delete(oldestKey);
        }
      }
      return result;
    },
    [sessionId, normalizePath, directoryCacheTtlMs]
  );

  // 加载目录内容
  const loadDirectory = React.useCallback(
    async (
      path: string,
      updateInput: boolean = true,
      options?: { preferCache?: boolean; forceRefresh?: boolean }
    ) => {
      setFilesLoading(true);
      setError(null);
      try {
        const normalizedPath = normalizePath(path);
        const result = await getDirectoryListing(normalizedPath, options);
        setFiles(result.files);
        setSelectedPath(normalizedPath);
        if (updateInput) {
          setPathInput(normalizedPath);
        }
      } catch (err) {
        console.error("Failed to load directory:", path, err);
        setError(err instanceof Error ? err.message : t("加载失败", "Load failed"));
        setFiles([]);
      } finally {
        setFilesLoading(false);
      }
    },
    [normalizePath, getDirectoryListing, t]
  );

  // 展开树节点到指定路径
  const expandTreeToPath = React.useCallback(async (targetPath: string, options?: { preferCache?: boolean; forceRefresh?: boolean }) => {
    if (targetPath === "/") {
      setTree([{ name: "/", path: "/", expanded: true, loaded: false }]);
      return;
    }

    // 解析路径层级
    const parts = targetPath.split("/").filter(Boolean);

    // 逐层加载并构建树
    const buildTree = async (): Promise<TreeNode[]> => {
      const rootChildren = await loadDirs("/");
      const root: TreeNode = { name: "/", path: "/", expanded: true, loaded: true, children: rootChildren };

      let currentNodes = rootChildren;
      for (let i = 0; i < parts.length; i++) {
        const currentPath = "/" + parts.slice(0, i + 1).join("/");
        const targetNode = currentNodes.find(n => n.path === currentPath);

        if (targetNode) {
          const children = await loadDirs(currentPath);
          targetNode.expanded = true;
          targetNode.loaded = true;
          targetNode.children = children;
          currentNodes = children;
        } else {
          break;
        }
      }

      return [root];
    };

    const loadDirs = async (path: string): Promise<TreeNode[]> => {
      try {
        const result = await getDirectoryListing(path, options);
        return result.files.filter(f => f.is_dir).map(d => ({
          name: d.name,
          path: d.path,
          expanded: false,
          loaded: false,
        }));
      } catch {
        return [];
      }
    };

    const newTree = await buildTree();
    setTree(newTree);
  }, [getDirectoryListing]);

  // 灞曞紑/鎶樺彔鏍戣妭鐐?
  const toggleNode = React.useCallback(async (nodePath: string, forceExpand: boolean = false) => {
    const findNode = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.path === nodePath) return node;
        if (node.children) {
          const found = findNode(node.children);
          if (found) return found;
        }
      }
      return null;
    };

    const updateTree = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(node => {
        if (node.path === nodePath) {
          return { ...node, expanded: forceExpand || !node.expanded };
        }
        if (node.children) {
          return { ...node, children: updateTree(node.children) };
        }
        return node;
      });
    };

    const node = findNode(treeRef.current);
    if (node && !node.loaded) {
      setTreeLoading(nodePath);
      try {
        const result = await getDirectoryListing(nodePath, { preferCache: true });
        const dirs = result.files.filter(f => f.is_dir);
        const children: TreeNode[] = dirs.map(d => ({
          name: d.name,
          path: d.path,
          expanded: false,
          loaded: false,
        }));

        const updateWithChildren = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map(n => {
            if (n.path === nodePath) {
              return { ...n, expanded: true, loaded: true, children };
            }
            if (n.children) {
              return { ...n, children: updateWithChildren(n.children) };
            }
            return n;
          });
        };
        setTree((prev) => updateWithChildren(prev));
      } catch {
        // 静默处理
      } finally {
        setTreeLoading(null);
      }
    } else {
      setTree((prev) => updateTree(prev));
    }
  }, [getDirectoryListing]);

  // 处理路径输入回车
  const handlePathSubmit = React.useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const path = pathInput.trim() || "/";
      await loadDirectory(path, true, { preferCache: true });
      await expandTreeToPath(path, { preferCache: true });
    }
  }, [pathInput, loadDirectory, expandTreeToPath]);

  // 刷新当前目录
  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    const path = pathInput.trim() || "/";
    try {
      await loadDirectory(path, false, { forceRefresh: true, preferCache: false });
      await expandTreeToPath(path, { forceRefresh: true, preferCache: false });
    } finally {
      setRefreshing(false);
    }
  }, [pathInput, loadDirectory, expandTreeToPath]);

  // 监听终端目录变化：弱网下做防抖并优先走缓存
  React.useEffect(() => {
    if (!currentDir) {
      return;
    }
    const normalizedCurrentDir = normalizePath(currentDir);
    if (normalizedCurrentDir === selectedPathRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      loadDirectory(normalizedCurrentDir, true, { preferCache: true });
      expandTreeToPath(normalizedCurrentDir, { preferCache: true });
    }, currentDirDebounceMs);
    return () => clearTimeout(timer);
  }, [currentDir, loadDirectory, expandTreeToPath, currentDirDebounceMs, normalizePath]);

  // 鍒涘缓 tar.gz 鍘嬬缉鍖?
  const createTarGz = React.useCallback(
    async (
      files: Array<{ file: File; path: string }>,
      onProgress?: (progress: {
        processedFiles: number;
        totalFiles: number;
        processedBytes: number;
        totalBytes: number;
        currentPath: string;
      }) => void
    ): Promise<Blob> => {
      return createTarGzArchive(files, onProgress);
    },
    []
  );

  const uploadBatchWithRetry = React.useCallback(
    async (
      filesToUpload: Array<{ file: File; path: string }>,
      maxRetries: number = 1,
      concurrent: number = uploadBatchConcurrent
    ) => {
      let attempt = 0;
      let lastError: unknown = null;

      while (attempt <= maxRetries) {
        try {
          return await uploadBatch(sessionId, selectedPath, filesToUpload, false, concurrent);
        } catch (error) {
          lastError = error;
          attempt += 1;
          if (attempt > maxRetries) {
            break;
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error(t("批量上传失败", "Batch upload failed"));
    },
    [sessionId, selectedPath, uploadBatchConcurrent, t]
  );

  const mapBatchFailures = React.useCallback(
    (
      filesToUpload: Array<{ file: File; path: string }>,
      errors: string[]
    ): UploadFailureItem[] => {
      if (errors.length === 0) {
        return [];
      }

      const byPath = new Map<string, { file: File; path: string }>();
      for (const item of filesToUpload) {
        byPath.set(item.path, item);
      }

      const failures: UploadFailureItem[] = [];
      const matchedPaths = new Set<string>();

      for (const error of errors) {
        const separatorIndex = error.indexOf(":");
        const errorPath = separatorIndex > 0 ? error.slice(0, separatorIndex).trim() : "";

        if (errorPath && byPath.has(errorPath)) {
          const matched = byPath.get(errorPath)!;
          failures.push({ file: matched.file, path: matched.path, reason: error });
          matchedPaths.add(matched.path);
        }
      }

      if (failures.length === 0) {
        return filesToUpload.map(item => ({ file: item.file, path: item.path, reason: errors[0] }));
      }

      for (const item of filesToUpload) {
        if (!matchedPaths.has(item.path) && failures.length < errors.length) {
          failures.push({ file: item.file, path: item.path, reason: errors[0] });
        }
      }

      return failures;
    },
    []
  );

  const uploadFilesByBatch = React.useCallback(
    async (
      filesToUpload: Array<{ file: File; path: string }>,
      totalBytes: number
    ): Promise<{ successCount: number; failures: UploadFailureItem[]; cancelled: boolean }> => {
      const batchSize = 50;
      let successCount = 0;
      let uploadedBytes = 0;
      const failures: UploadFailureItem[] = [];

      for (let start = 0; start < filesToUpload.length; start += batchSize) {
        if (uploadCancelledRef.current) {
          return { successCount, failures, cancelled: true };
        }

        const end = Math.min(start + batchSize, filesToUpload.length);
        const batch = filesToUpload.slice(start, end);

        setUploadProgress(prev => [...prev.slice(-2), t(`批量上传: ${start + 1}-${end}/${filesToUpload.length}`, `Batch upload: ${start + 1}-${end}/${filesToUpload.length}`)]);

        try {
          const result = await uploadBatchWithRetry(batch, 1, uploadBatchConcurrent);
          const batchFailures = mapBatchFailures(batch, result.errors);
          failures.push(...batchFailures);

          const failedPathSet = new Set(batchFailures.map(item => item.path));
          const batchUploadedBytes = batch
            .filter(item => !failedPathSet.has(item.path))
            .reduce((sum, item) => sum + item.file.size, 0);

          uploadedBytes += batchUploadedBytes;
          successCount += result.uploaded;

          if (result.errors.length > 0) {
            setUploadProgress(prev => [...prev.slice(-2), ...result.errors.slice(0, 3).map(err => t(`失败: ${err}`, `Failed: ${err}`))].slice(-3));
          }

          setUploadStats({
            current: successCount,
            total: filesToUpload.length,
            uploadedBytes,
            totalBytes,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          for (const item of batch) {
            failures.push({ file: item.file, path: item.path, reason });
          }
          setUploadProgress(prev => [...prev.slice(-2), t(`失败: ${start + 1}-${end}`, `Failed: ${start + 1}-${end}`)]);
        }
      }

      return {
        successCount,
        failures,
        cancelled: uploadCancelledRef.current,
      };
    },
    [mapBatchFailures, uploadBatchWithRetry, t]
  );

  // 处理文件拖拽上传
  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    setUploading(true);
    setUploadProgress([]);
    setLastUploadFailures([]);
    setUploadStage("batch");
    uploadCancelledRef.current = false;
    setUploadStats(INITIAL_UPLOAD_STATS);

    try {
      // 读取所有文件（包括文件夹内容）
      const dropSnapshot = snapshotDropPayload(e.dataTransfer);
      const allFiles = await collectDroppedFiles(dropSnapshot);

      if (allFiles.length === 0) {
        push(t("没有可上传的文件", "No files to upload"));
        return;
      }

      const totalBytes = calculateTotalBytes(allFiles);
      setUploadStats({ current: 0, total: allFiles.length, uploadedBytes: 0, totalBytes });

      let shouldUseCompression = compress;

      // 如果文件超过100个且未开启压缩，提示用户
      if (allFiles.length > 100 && !compress) {
        const shouldCompress = confirm(
          t(
            `检测到 ${allFiles.length} 个文件，启用压缩传输可以提高上传速度。是否启用压缩传输？`,
            `${allFiles.length} files detected. Enable compressed transfer to improve upload speed?`
          )
        );
        if (shouldCompress) {
          shouldUseCompression = true;
          setCompress(true);
        }
      }

      if (shouldUseCompression) {
        setUploadStage("compressing");
        // 前端压缩上传
        setUploadProgress([t(`正在压缩 ${allFiles.length} 个文件...`, `Compressing ${allFiles.length} files...`)]);
        const tarGzBlob = await createTarGz(allFiles, (progress) => {
          setUploadStats({
            current: progress.processedFiles,
            total: progress.totalFiles,
            uploadedBytes: progress.processedBytes,
            totalBytes: progress.totalBytes,
          });
          setUploadProgress(prev => [
            ...prev.slice(-2),
            t(`压缩中: ${progress.currentPath}`, `Compressing: ${progress.currentPath}`),
          ].slice(-3));
        });

        if (uploadCancelledRef.current) return;

        setUploadStage("compressed_upload");
        setUploadStats({
          current: 0,
          total: 1,
          uploadedBytes: 0,
          totalBytes: tarGzBlob.size,
        });
        setUploadProgress(prev => [...prev.slice(-2), t("上传压缩包...", "Uploading compressed archive...")]);
        const result = await uploadTargz(sessionId, selectedPath, tarGzBlob, "upload.tar.gz", {
          onProgress: (transferProgress) => {
            setUploadStats((prev) => ({
              current: prev.current,
              total: prev.total,
              uploadedBytes: transferProgress.loaded,
              totalBytes: transferProgress.total ?? prev.totalBytes,
            }));
          },
        });
        setUploadStats({
          current: 1,
          total: 1,
          uploadedBytes: tarGzBlob.size,
          totalBytes: tarGzBlob.size,
        });

        if (result.errors.length > 0) {
          setUploadProgress(prev => [...prev.slice(-2), ...result.errors.map(err => t(`失败: ${err}`, `Failed: ${err}`))].slice(-3));
          push(t(`压缩上传完成但有 ${result.errors.length} 条错误`, `Compressed upload completed with ${result.errors.length} errors`));
        }

        push(t(`已上传 ${result.uploaded}/${allFiles.length} 个文件`, `Uploaded ${result.uploaded}/${allFiles.length} files`));
      } else {
        setUploadStage("batch");
        const uploadResult = await uploadFilesByBatch(allFiles, totalBytes);

        if (uploadResult.cancelled) {
          push(t(`已取消上传，成功 ${uploadResult.successCount}/${allFiles.length} 个文件`, `Upload canceled. Succeeded ${uploadResult.successCount}/${allFiles.length} files`));
          return;
        }

        if (uploadResult.failures.length > 0) {
          setLastUploadFailures(uploadResult.failures);
          const preview = uploadResult.failures.slice(0, 3).map(item => `${item.path}: ${item.reason}`).join(language === "en-US" ? "; " : "；");
          push(t(`上传完成：成功 ${uploadResult.successCount}/${allFiles.length}，失败 ${uploadResult.failures.length}。${preview}`, `Upload completed: success ${uploadResult.successCount}/${allFiles.length}, failed ${uploadResult.failures.length}. ${preview}`));
        } else {
          push(t(`成功上传 ${uploadResult.successCount}/${allFiles.length} 个文件`, `Uploaded ${uploadResult.successCount}/${allFiles.length} files successfully`));
        }
      }

      await loadDirectory(selectedPath, false, { forceRefresh: true, preferCache: false });
    } catch (err) {
      if (!uploadCancelledRef.current) {
        push(err instanceof Error ? err.message : t("上传失败", "Upload failed"));
      }
    } finally {
      setUploading(false);
      setUploadProgress([]);
      setUploadStats(INITIAL_UPLOAD_STATS);
      setUploadStage("batch");
    }
  }, [sessionId, selectedPath, compress, push, loadDirectory, uploadFilesByBatch, t, language]);

  const handleCancelUpload = React.useCallback(() => {
    uploadCancelledRef.current = true;
  }, []);

  const handleRetryFailedUploads = React.useCallback(async () => {
    if (lastUploadFailures.length === 0 || uploading) {
      return;
    }

    const retryTargets = lastUploadFailures.map(item => ({ file: item.file, path: item.path }));
    const totalBytes = calculateTotalBytes(retryTargets);

    setUploading(true);
    setUploadProgress([t(`重试失败文件 ${retryTargets.length} 个...`, `Retrying ${retryTargets.length} failed files...`)]);
    setUploadStats({ current: 0, total: retryTargets.length, uploadedBytes: 0, totalBytes });
    setUploadStage("batch");
    uploadCancelledRef.current = false;

    try {
      const uploadResult = await uploadFilesByBatch(retryTargets, totalBytes);

      if (uploadResult.cancelled) {
        push(t(`已取消重试，成功 ${uploadResult.successCount}/${retryTargets.length} 个文件`, `Retry canceled. Succeeded ${uploadResult.successCount}/${retryTargets.length} files`));
        return;
      }

      if (uploadResult.failures.length > 0) {
        setLastUploadFailures(uploadResult.failures);
        const preview = uploadResult.failures.slice(0, 3).map(item => `${item.path}: ${item.reason}`).join(language === "en-US" ? "; " : "；");
        push(t(`重试完成：成功 ${uploadResult.successCount}/${retryTargets.length}，失败 ${uploadResult.failures.length}。${preview}`, `Retry completed: success ${uploadResult.successCount}/${retryTargets.length}, failed ${uploadResult.failures.length}. ${preview}`));
      } else {
        setLastUploadFailures([]);
        push(t(`重试成功：${uploadResult.successCount}/${retryTargets.length}`, `Retry succeeded: ${uploadResult.successCount}/${retryTargets.length}`));
      }

      await loadDirectory(selectedPath, false, { forceRefresh: true, preferCache: false });
    } catch (error) {
      push(error instanceof Error ? error.message : t("重试失败", "Retry failed"));
    } finally {
      setUploading(false);
      setUploadProgress([]);
      setUploadStats(INITIAL_UPLOAD_STATS);
      setUploadStage("batch");
    }
  }, [lastUploadFailures, uploading, uploadFilesByBatch, push, loadDirectory, selectedPath, t, language]);

  const handleContextMenu = React.useCallback((e: React.MouseEvent, file?: FileInfo) => {
    e.preventDefault();
    const menuHeight = 280;
    const menuWidth = 150;
    const x = e.clientX + menuWidth > window.innerWidth ? e.clientX - menuWidth : e.clientX;
    const y = e.clientY + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 10 : e.clientY;

    let menuType: 'blank' | 'single' | 'multiple';
    let menuFiles: FileInfo[];

    if (!file) {
      setSelectedFiles(new Set());
      menuType = 'blank';
      menuFiles = [];
    } else if (selectedFiles.has(file.path)) {
      menuType = selectedFiles.size > 1 ? 'multiple' : 'single';
      menuFiles = Array.from(selectedFiles).map(path => files.find(f => f.path === path)).filter(Boolean) as FileInfo[];
    } else {
      setSelectedFiles(new Set([file.path]));
      menuType = 'single';
      menuFiles = [file];
    }

    setContextMenu({ x, y, type: menuType, files: menuFiles });
  }, [selectedFiles, files]);

  const handleCloseContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  const downloadItemsWithProgress = React.useCallback(async (filesToDownload: FileInfo[]) => {
    if (filesToDownload.length === 0) {
      return;
    }

    setDownloading(true);
    setDownloadStats(null);
    try {
      for (let index = 0; index < filesToDownload.length; index += 1) {
        const file = filesToDownload[index];
        setDownloadStats({
          current: index + 1,
          total: filesToDownload.length,
          loadedBytes: 0,
          totalBytes: 0,
          phase: file.is_dir ? "compressing" : "transferring",
          targetName: file.name,
        });

        const blob = await downloadFile(sessionId, file.path, {
          onProgress: (progress) => {
            setDownloadStats((prev) => {
              if (!prev) {
                return prev;
              }
              return {
                ...prev,
                phase: "transferring",
                loadedBytes: progress.loaded,
                totalBytes: progress.total ?? prev.totalBytes,
              };
            });
          },
        });

        setDownloadStats((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            phase: "transferring",
            loadedBytes: blob.size,
            totalBytes: blob.size,
          };
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.is_dir ? `${file.name}.tar.gz` : file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
      push(t(`已下载 ${filesToDownload.length} 个文件`, `Downloaded ${filesToDownload.length} file(s)`));
    } catch (err) {
      push(err instanceof Error ? err.message : t("下载失败", "Download failed"));
    } finally {
      setDownloading(false);
      setDownloadStats(null);
    }
  }, [sessionId, push, t]);

  const handleContextDownload = React.useCallback(async () => {
    if (!contextMenu) return;
    setContextMenu(null);

    const filesToDownload =
      selectedFiles.size > 0
        ? (Array.from(selectedFiles).map(path => files.find(f => f.path === path)).filter(Boolean) as FileInfo[])
        : contextMenu.files;
    if (filesToDownload.length === 0) return;
    await downloadItemsWithProgress(filesToDownload);
  }, [contextMenu, selectedFiles, files, downloadItemsWithProgress]);

  const handleContextAction = React.useCallback((action: "mkdir" | "touch" | "rename" | "chmod" | "delete" | "download") => {
    if (!contextMenu) return;
    const { files } = contextMenu;
    setContextMenu(null);

    if (action === "delete") {
      if (files.length === 0) return;
      if (confirm(t(`确定删除 ${files.length} 个项目？`, `Delete ${files.length} item(s)?`))) {
        Promise.all(files.map(file => deletePath(sessionId, file.path))).then(() => {
          push(t("删除成功", "Deleted successfully"));
          setSelectedFiles(new Set());
          loadDirectory(selectedPath, false, { forceRefresh: true, preferCache: false });
        }).catch(() => push(t("删除失败", "Delete failed")));
      }
    } else if (action === "download") {
      handleContextDownload();
    } else {
      setDialog({ type: action, files });
      if (action === "rename") {
        setDialogInput(files[0]?.name || "");
      } else if (action === "chmod") {
        setDialogInput(permissionsToOctal(files[0]?.permissions || ""));
      } else {
        setDialogInput("");
      }
    }
  }, [contextMenu, sessionId, push, loadDirectory, selectedPath, t]);

  const handleDialogSubmit = React.useCallback(async () => {
    if (!dialog || !dialogInput.trim()) return;

    try {
      if (dialog.type === "mkdir") {
        await mkdir(sessionId, `${selectedPath}/${dialogInput}`);
        push(t("创建成功", "Created successfully"));
      } else if (dialog.type === "touch") {
        await touchPath(sessionId, `${selectedPath}/${dialogInput}`);
        push(t("创建成功", "Created successfully"));
      } else if (dialog.type === "rename") {
        const target = dialog.files[0];
        if (!target) return;
        const slashIndex = target.path.lastIndexOf('/');
        const dir = slashIndex > 0 ? target.path.slice(0, slashIndex) : "/";
        const newPath = `${dir}/${dialogInput.trim()}`;
        await renamePath(sessionId, target.path, newPath);
        push(t("重命名成功", "Renamed successfully"));
      } else if (dialog.type === "chmod") {
        const filesToChmod = dialog.files || [];
        if (filesToChmod.length === 0) return;

        setChmodLoading(true);
        setDialog(null);

        try {
          await Promise.all(filesToChmod.map(file =>
            chmodPath(sessionId, file.path, dialogInput, chmodRecursive)
          ));
          push(t(`修改权限成功 (${filesToChmod.length} 个项目)`, `Permissions updated (${filesToChmod.length} item(s))`));
          setSelectedFiles(new Set());
        } catch (err) {
          push(err instanceof Error ? err.message : t("修改权限失败", "Failed to change permissions"));
        } finally {
          setChmodLoading(false);
        }
      }
      if (dialog.type !== "chmod") {
        setDialog(null);
      }
      setDialogInput("");
      setChmodRecursive(false);
      loadDirectory(selectedPath, false, { forceRefresh: true, preferCache: false });
    } catch (err) {
      push(err instanceof Error ? err.message : t("操作失败", "Operation failed"));
    }
  }, [dialog, dialogInput, sessionId, selectedPath, push, loadDirectory, t]);

  React.useEffect(() => {
    if (contextMenu) {
      document.addEventListener("click", handleCloseContextMenu);
      return () => document.removeEventListener("click", handleCloseContextMenu);
    }
  }, [contextMenu, handleCloseContextMenu]);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      setIsDragging(false);
    }
  }, []);

  // 处理下载
  const handleDownload = React.useCallback(async () => {
    if (selectedFiles.size === 0) return;
    const filesToDownload = Array.from(selectedFiles)
      .map(path => files.find(f => f.path === path))
      .filter(Boolean) as FileInfo[];
    await downloadItemsWithProgress(filesToDownload);
  }, [selectedFiles, files, downloadItemsWithProgress]);

  // 列宽调整
  React.useEffect(() => {
    if (!resizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.movementX;
      setColWidths(prev => ({
        ...prev,
        [resizingCol]: Math.max(50, prev[resizingCol as keyof typeof prev] + delta)
      }));
    };

    const handleMouseUp = () => setResizingCol(null);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingCol]);

  // 处理文件/文件夹点击
  const handleFileClick = React.useCallback((file: FileInfo, ctrlKey: boolean) => {
    const now = Date.now();
    const isDoubleClick = now - lastClickTime.current < 300 && lastClickPath.current === file.path;

    lastClickTime.current = now;
    lastClickPath.current = file.path;

    if (ctrlKey) {
      // Ctrl 多选
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedFiles(newSelected);
      setSelectedFile(file);
    } else {
      // 鍗曢€?
      setSelectedFile(file);
      setSelectedFiles(new Set([file.path]));

      // 閫氱煡鐖剁粍浠堕€変腑鐨勬枃浠?
      if (!file.is_dir && onFileSelect) {
        onFileSelect(file.path);
      }

      if (file.is_dir && isDoubleClick) {
        loadDirectory(file.path, true, { preferCache: true });
        expandTreeToPath(file.path, { preferCache: true });
      }
    }
  }, [selectedFiles, loadDirectory, expandTreeToPath, onFileSelect]);

  const parentPath = React.useMemo(() => {
    const normalized = normalizePath(selectedPath);
    if (normalized === "/") {
      return null;
    }
    const slashIndex = normalized.lastIndexOf("/");
    return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
  }, [selectedPath, normalizePath]);

  const handleNavigateToParent = React.useCallback(() => {
    if (!parentPath) {
      return;
    }
    setSelectedFile(null);
    setSelectedFiles(new Set());
    onFileSelect?.(null);
    loadDirectory(parentPath, true, { preferCache: true });
    expandTreeToPath(parentPath, { preferCache: true });
  }, [parentPath, onFileSelect, loadDirectory, expandTreeToPath]);

  const handleParentItemClick = React.useCallback(() => {
    setSelectedFile(null);
    setSelectedFiles(new Set());
    onFileSelect?.(null);
  }, [onFileSelect]);

  const loadDirectoryRef = React.useRef(loadDirectory);
  const toggleNodeRef = React.useRef(toggleNode);

  React.useEffect(() => {
    loadDirectoryRef.current = loadDirectory;
    toggleNodeRef.current = toggleNode;
  }, [loadDirectory, toggleNode]);

  // 会话切换时初始化目录树，避免依赖变化导致重复初始化
  React.useEffect(() => {
    directoryCacheRef.current.clear();
    setTree(createRootTree());
    setSelectedPath("/");
    setPathInput("/");
    setFiles([]);
    setSelectedFile(null);
    setSelectedFiles(new Set());
    setDownloading(false);
    setDownloadStats(null);
    setContextMenu(null);
    setDialog(null);
    setError(null);
    onFileSelect?.(null);

    loadDirectoryRef.current("/", true, { preferCache: true });
    toggleNodeRef.current("/", true);
  }, [sessionId, onFileSelect]);

  // 渲染树节点
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isLoading = treeLoading === node.path;
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer text-xs truncate ${
            isSelected
              ? (isDark ? "bg-indigo-600/50 text-white" : "bg-indigo-100 text-indigo-700")
              : (isDark ? "hover:bg-slate-700 text-slate-300" : "hover:bg-slate-100 text-slate-600")
          }`}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => {
            loadDirectory(node.path, true, { preferCache: true });
          }}
          onDoubleClick={() => {
            toggleNode(node.path);
          }}
        >
          <span
            className="w-4 text-center flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(node.path);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
            }}
          >
            {isLoading ? (
              <span className="animate-spin inline-block">⟳</span>
            ) : node.children && node.children.length > 0 ? (
              node.expanded ? "▼" : "▶"
            ) : node.loaded ? "" : "▶"}
          </span>
          <span className="flex-shrink-0">📁</span>
          <span className="truncate">{node.name}</span>
        </div>
        {node.expanded && node.children && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const uploadPercent = calculatePercent(uploadStats.uploadedBytes, uploadStats.totalBytes);
  const uploadStatusText =
    uploadStage === "compressing"
      ? t("正在压缩文件...", "Compressing files...")
      : uploadStage === "compressed_upload"
      ? t("正在上传压缩包...", "Uploading compressed archive...")
      : t("正在上传文件...", "Uploading files...");
  const uploadPhaseText =
    uploadStage === "compressing" ? t("压缩进度", "Compression Progress") : uploadStage === "compressed_upload" ? t("压缩包传输进度", "Archive Transfer Progress") : t("上传进度", "Upload Progress");
  const downloadPercent =
    downloadStats && downloadStats.totalBytes > 0
      ? calculatePercent(downloadStats.loadedBytes, downloadStats.totalBytes)
      : null;

  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex items-center gap-2">
        <h3 className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>
          {t("文件浏览", "File Browser")}
        </h3>
      </div>

      {/* 路径输入框 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={handlePathSubmit}
          placeholder={t("输入路径，按回车跳转", "Input path and press Enter")}
          className={`flex-1 px-2 py-1 text-xs rounded border ${
            isDark
              ? "bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:border-indigo-500"
              : "bg-white border-slate-300 text-slate-700 placeholder:text-slate-400 focus:border-indigo-400"
          } focus:outline-none`}
        />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={`px-2 py-1 text-xs rounded border ${
            isDark
              ? "bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
              : "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200"
          } ${refreshing ? "opacity-50 cursor-not-allowed" : ""}`}
          title={t("刷新", "Refresh")}
        >
          {refreshing ? <span className="animate-spin inline-block">⟳</span> : "↻"}
        </button>
        <label className={`flex items-center gap-1 px-2 py-1 text-xs rounded border cursor-pointer ${
          isDark
            ? "bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
            : "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200"
        }`}>
          <input
            type="checkbox"
            checked={compress}
            onChange={(e) => setCompress(e.target.checked)}
            className="w-3 h-3"
          />
          <span>{t("压缩上传", "Compressed upload")}</span>
        </label>
      </div>

      <div
        className={`flex rounded border flex-1 min-h-0 ${isDark ? "border-slate-700" : "border-slate-200"} ${(uploading || downloading) ? "opacity-50" : ""} relative`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 拖拽遮罩 */}
        {isDragging && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center ${isDark ? "bg-slate-800/90" : "bg-slate-100/90"} border-2 border-dashed ${isDark ? "border-indigo-500" : "border-indigo-400"}`}>
            <div className="text-center">
              <div className={`text-2xl mb-2 ${isDark ? "text-indigo-400" : "text-indigo-500"}`}>📁</div>
              <div className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                {t("拖至此处上传到当前文件夹", "Drop here to upload into current folder")}
              </div>
            </div>
          </div>
        )}
        {/* 上传进度遮罩 */}
        {uploading && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center ${isDark ? "bg-slate-900/95" : "bg-white/95"}`}>
            <div className="w-full max-w-md px-4">
              <div className={`text-center mb-2 text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                {uploadStatusText}
              </div>
              {uploadStats.totalBytes > 0 && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className={isDark ? "text-slate-400" : "text-slate-600"}>
                      {uploadPhaseText}
                    </span>
                    <span className={isDark ? "text-slate-400" : "text-slate-600"}>
                      {Math.round(uploadPercent)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className={isDark ? "text-slate-500" : "text-slate-500"}>
                      {formatFileSize(uploadStats.uploadedBytes)} / {formatFileSize(uploadStats.totalBytes)}
                    </span>
                    <span className={isDark ? "text-slate-500" : "text-slate-500"}>
                      {uploadStats.current} / {uploadStats.total}
                    </span>
                  </div>
                  <div className={`h-2 rounded-full ${isDark ? "bg-slate-700" : "bg-slate-200"}`}>
                    <div
                      className="h-2 rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${uploadPercent}%` }}
                    />
                  </div>
                </div>
              )}
              <div className={`max-h-24 overflow-y-auto rounded border mb-2 ${isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                {uploadProgress.slice(-3).map((msg, i) => (
                  <div key={i} className={`px-2 py-0.5 text-[11px] ${isDark ? "text-slate-400" : "text-slate-600"} border-b ${isDark ? "border-slate-700" : "border-slate-200"} last:border-b-0`}>
                    {msg}
                  </div>
                ))}
              </div>
              <button
                onClick={handleCancelUpload}
                className={`w-full px-3 py-2 text-sm rounded ${isDark ? "bg-rose-600 hover:bg-rose-500" : "bg-rose-500 hover:bg-rose-400"} text-white`}
              >
                {t("取消上传", "Cancel Upload")}
              </button>
            </div>
          </div>
        )}

        {downloading && downloadStats && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center ${isDark ? "bg-slate-900/95" : "bg-white/95"}`}>
            <div className="w-full max-w-md px-4">
              <div className={`text-center mb-2 text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                {downloadStats.phase === "compressing" ? t("正在服务端压缩...", "Compressing on server...") : t("正在下载...", "Downloading...")}
              </div>
              <div className={`text-center mb-3 text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                {downloadStats.current} / {downloadStats.total} · {downloadStats.targetName}
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className={isDark ? "text-slate-400" : "text-slate-600"}>
                    {downloadStats.phase === "compressing" ? t("压缩进度", "Compression Progress") : t("传输进度", "Transfer Progress")}
                  </span>
                  <span className={isDark ? "text-slate-400" : "text-slate-600"}>
                    {downloadPercent === null ? t("计算中...", "Calculating...") : `${Math.round(downloadPercent)}%`}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className={isDark ? "text-slate-500" : "text-slate-500"}>
                    {formatFileSize(downloadStats.loadedBytes)} / {downloadStats.totalBytes > 0 ? formatFileSize(downloadStats.totalBytes) : t("未知大小", "Unknown size")}
                  </span>
                </div>
                <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-slate-700" : "bg-slate-200"}`}>
                  {downloadPercent === null ? (
                    <div className={`h-2 w-1/3 rounded-full animate-pulse ${isDark ? "bg-indigo-400/80" : "bg-indigo-500/70"}`} />
                  ) : (
                    <div
                      className="h-2 rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!uploading && lastUploadFailures.length > 0 && (
          <div className={`absolute top-2 right-2 z-20 px-3 py-2 rounded border text-xs ${isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-700"}`}>
            <div className="mb-2">{t(`上次上传失败 ${lastUploadFailures.length} 个文件`, `${lastUploadFailures.length} files failed in last upload`)}</div>
            <button
              onClick={handleRetryFailedUploads}
              className={`px-2 py-1 rounded ${isDark ? "bg-indigo-600 hover:bg-indigo-500" : "bg-indigo-500 hover:bg-indigo-400"} text-white`}
            >
              {t("重试失败项", "Retry Failed Items")}
            </button>
          </div>
        )}

        {/* chmod 加载遮罩 */}
        {chmodLoading && (
          <div className={`absolute inset-0 z-10 flex items-center justify-center ${isDark ? "bg-slate-900/95" : "bg-white/95"}`}>
            <div className="text-center">
              <div className={`text-sm font-medium mb-2 ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                {chmodRecursive ? t("正在递归修改权限，请稍候...", "Applying permissions recursively...") : t("正在修改权限...", "Applying permissions...")}
              </div>
              <div className="animate-spin text-2xl">⟳</div>
            </div>
          </div>
        )}
        {/* 左侧树形目录 */}
        <div className={`w-1/3 overflow-auto border-r ${isDark ? "border-slate-700 bg-slate-800/50 dark-scrollbar" : "border-slate-200 bg-slate-50 light-scrollbar"}`}>
          <div className="p-1">
            {tree.map(node => renderTreeNode(node))}
          </div>
        </div>

        {/* 右侧文件列表 */}
        <div
          className={`flex-1 overflow-auto ${isDark ? "bg-slate-900/30 dark-scrollbar" : "bg-white light-scrollbar"}`}
          onContextMenu={(e) => handleContextMenu(e)}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedFiles(new Set());
            }
          }}
        >
          {filesLoading ? (
            <div className={`flex items-center justify-center h-full text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <span className="animate-spin mr-2">⟳</span> {t("加载中...", "Loading...")}
            </div>
          ) : error ? (
            <div className={`flex items-center justify-center h-full text-xs ${isDark ? "text-rose-400" : "text-rose-500"}`}>
              {error}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className={`sticky top-0 ${isDark ? "bg-slate-800" : "bg-slate-100"}`}>
                <tr className={isDark ? "text-slate-400" : "text-slate-500"}>
                  <th className="text-left py-1 px-2 font-medium">{t("名称", "Name")}</th>
                  <th className="text-right py-1 px-2 font-medium relative" style={{ width: colWidths.size }}>
                    {t("大小", "Size")}
                    <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500" onMouseDown={() => setResizingCol("size")} />
                  </th>
                  <th className="text-left py-1 px-2 font-medium relative" style={{ width: colWidths.permissions }}>
                    {t("权限", "Permissions")}
                    <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500" onMouseDown={() => setResizingCol("permissions")} />
                  </th>
                  <th className="text-left py-1 px-2 font-medium relative" style={{ width: colWidths.owner }}>
                    {t("用户", "Owner")}
                    <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500" onMouseDown={() => setResizingCol("owner")} />
                  </th>
                  <th className="text-left py-1 px-2 font-medium" style={{ width: colWidths.modified }}>{t("修改时间", "Modified Time")}</th>
                </tr>
              </thead>
              <tbody>
                {parentPath && (
                  <tr
                    key="__parent__"
                    className={`cursor-pointer ${isDark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-50 text-slate-600"}`}
                    onClick={handleParentItemClick}
                    onDoubleClick={handleNavigateToParent}
                  >
                    <td className="py-1 px-2 truncate max-w-[120px]" title={t(`返回上一级: ${parentPath}`, `Go to parent: ${parentPath}`)}>
                      <span className="mr-1">📁</span>
                      ...
                    </td>
                    <td className={`py-1 px-2 text-right ${isDark ? "text-slate-400" : "text-slate-500"}`}>-</td>
                    <td className={`py-1 px-2 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>-</td>
                    <td className={`py-1 px-2 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>-</td>
                    <td className={`py-1 px-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("返回上一级", "Go to parent")}</td>
                  </tr>
                )}
                {files.map((file) => (
                  <tr
                    key={file.path}
                    className={`cursor-pointer ${
                      selectedFiles.has(file.path)
                        ? (isDark ? "bg-indigo-600/30" : "bg-indigo-100")
                        : (isDark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-50 text-slate-600")
                    }`}
                    onClick={(e) => handleFileClick(file, e.ctrlKey || e.metaKey)}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      handleContextMenu(e, file);
                    }}
                  >
                    <td className="py-1 px-2 truncate max-w-[120px]" title={file.name}>
                      <span className="mr-1">{file.is_dir ? "📁" : "📄"}</span>
                      {file.name}
                    </td>
                    <td className={`py-1 px-2 text-right ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {file.is_dir ? "-" : formatFileSize(file.size)}
                    </td>
                    <td className={`py-1 px-2 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {file.permissions}
                    </td>
                    <td className={`py-1 px-2 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`} title={`${file.owner}:${file.group}`}>
                      {file.owner}
                    </td>
                    <td className={`py-1 px-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {file.modified}
                    </td>
                  </tr>
                ))}
                {files.length === 0 && !filesLoading && (
                  <tr>
                    <td colSpan={5} className={`py-4 text-center ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      {t("空目录", "Empty directory")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className={`fixed z-50 rounded shadow-lg border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'blank' && (
            <>
              <button onClick={() => handleContextAction("mkdir")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("新建文件夹", "New Folder")}
              </button>
              <button onClick={() => handleContextAction("touch")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("新建文件", "New File")}
              </button>
            </>
          )}
          {contextMenu.type === 'multiple' && (
            <>
              <button onClick={() => handleContextAction("download")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("下载", "Download")}
              </button>
              <button onClick={() => handleContextAction("chmod")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("修改权限", "Change Permissions")}
              </button>
              <button onClick={() => handleContextAction("delete")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-rose-400" : "hover:bg-slate-100 text-rose-600"}`}>
                {t("删除", "Delete")}
              </button>
            </>
          )}
          {contextMenu.type === 'single' && (
            <>
              <button onClick={() => handleContextAction("download")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("下载", "Download")}
              </button>
              <button onClick={() => handleContextAction("rename")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("重命名", "Rename")}
              </button>
              <button onClick={() => handleContextAction("chmod")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("修改权限", "Change Permissions")}
              </button>
              <button onClick={() => handleContextAction("delete")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-rose-400" : "hover:bg-slate-100 text-rose-600"}`}>
                {t("删除", "Delete")}
              </button>
              <div className={`border-t ${isDark ? "border-slate-700" : "border-slate-200"}`} />
              <button onClick={() => handleContextAction("mkdir")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("新建文件夹", "New Folder")}
              </button>
              <button onClick={() => handleContextAction("touch")} className={`w-full px-4 py-2 text-left text-sm ${isDark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                {t("新建文件", "New File")}
              </button>
            </>
          )}
        </div>
      )}

      {/* 对话框 */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`rounded-lg shadow-xl p-4 w-80 ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <h3 className={`text-sm font-medium mb-3 ${isDark ? "text-slate-200" : "text-slate-700"}`}>
              {dialog.type === "mkdir" ? t("新建文件夹", "New Folder") : dialog.type === "touch" ? t("新建文件", "New File") : dialog.type === "rename" ? t("重命名", "Rename") : t("修改权限", "Change Permissions")}
            </h3>
            {dialog.type === "chmod" && dialog.files && dialog.files.length > 0 && (
              <div className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                {dialog.files.length === 1 ? dialog.files[0].name : t(`已选择 ${dialog.files.length} 个项目`, `${dialog.files.length} item(s) selected`)}
              </div>
            )}
            <div className="relative mb-3">
              <input
                type="text"
                value={dialogInput}
                onChange={(e) => setDialogInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDialogSubmit()}
                placeholder={dialog.type === "chmod" ? t("例如: 755", "e.g. 755") : t("输入名称", "Input name")}
                className={`w-full px-3 py-2 text-sm rounded border ${isDark ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-white border-slate-300 text-slate-700"}`}
                autoFocus
              />
              {dialog.type === "chmod" && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 group">
                  <span className={`cursor-help text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>?</span>
                  <div className={`hidden group-hover:block absolute right-0 top-6 w-64 p-3 rounded shadow-lg border text-xs z-10 ${isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-white border-slate-300 text-slate-700"}`}>
                    <div className="space-y-1">
                      <div><strong>755</strong> - {t("所有者可读写执行，其他人可读执行", "Owner can read/write/execute; others can read/execute")}</div>
                      <div><strong>644</strong> - {t("所有者可读写，其他人只读", "Owner can read/write; others read only")}</div>
                      <div><strong>777</strong> - {t("所有人可读写执行（不推荐）", "Everyone can read/write/execute (not recommended)")}</div>
                      <div><strong>700</strong> - {t("仅所有者可读写执行", "Only owner can read/write/execute")}</div>
                      <div><strong>600</strong> - {t("仅所有者可读写", "Only owner can read/write")}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {dialog.type === "chmod" && dialog.files?.some(f => f.is_dir) && (
              <label className={`flex items-center gap-2 mb-3 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                <input
                  type="checkbox"
                  checked={chmodRecursive}
                  onChange={(e) => setChmodRecursive(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>{t("应用到该文件夹下所有文件及目录", "Apply to all files and directories under this folder")}</span>
              </label>
            )}
            <div className="flex gap-2">
              <button onClick={() => setDialog(null)} className={`flex-1 px-3 py-2 text-sm rounded ${isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-200" : "bg-slate-200 hover:bg-slate-300 text-slate-700"}`}>
                {t("取消", "Cancel")}
              </button>
              <button onClick={handleDialogSubmit} className="flex-1 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-500 text-white">
                {t("确定", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

