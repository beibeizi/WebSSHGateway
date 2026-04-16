import { gzipSync, strToU8 } from "fflate";

type LegacyFileSystemFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type LegacyFileSystemDirectoryReader = {
  readEntries: (
    successCallback: (entries: LegacyFileSystemEntry[]) => void,
    errorCallback?: (error: DOMException) => void
  ) => void;
};

type LegacyFileSystemDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => LegacyFileSystemDirectoryReader;
};

type LegacyFileSystemEntry = LegacyFileSystemFileEntry | LegacyFileSystemDirectoryEntry;

type DropItemSnapshot = {
  entry: LegacyFileSystemEntry | null;
  fallbackFile: File | null;
};

type DroppedFile = {
  file: File;
  path: string;
};

type DropSnapshot = {
  itemSnapshots: DropItemSnapshot[];
  files: File[];
};

const getRelativePath = (file: File): string => {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, "/");
};

const isDirectoryPlaceholder = (file: File, path: string, directoryNames: Set<string>): boolean => {
  const normalizedPath = path.replace(/\\/g, "/");
  const hasRelativePath = Boolean((file as File & { webkitRelativePath?: string }).webkitRelativePath);

  if (normalizedPath.endsWith("/")) {
    return true;
  }

  if (!hasRelativePath && directoryNames.has(file.name) && file.size === 0) {
    return true;
  }

  return false;
};

const getFileFromEntry = async (entry: LegacyFileSystemFileEntry): Promise<File | null> => {
  return new Promise((resolve) => {
    try {
      entry.file(
        (file: File) => resolve(file),
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
};

const readDirectory = async (entry: LegacyFileSystemEntry, path = ""): Promise<DroppedFile[]> => {
  const results: DroppedFile[] = [];

  if (entry.isFile) {
    const file = await getFileFromEntry(entry);
    if (file) {
      results.push({ file, path });
    }
    return results;
  }

  const reader = entry.createReader();
  let batch: LegacyFileSystemEntry[] = [];
  do {
    batch = await new Promise<LegacyFileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });

    if (batch.length === 0) {
      break;
    }

    for (const subEntry of batch) {
      const subPath = path ? `${path}/${subEntry.name}` : subEntry.name;
      const subResults = await readDirectory(subEntry, subPath);
      results.push(...subResults);
    }
  } while (batch.length > 0);

  return results;
};

const buildDedupKey = (item: DroppedFile): string => {
  return `${item.path}::${item.file.size}::${item.file.lastModified}`;
};

const appendIfValid = (
  target: DroppedFile[],
  file: File,
  directoryNames: Set<string>,
  seen: Set<string>
) => {
  const path = getRelativePath(file);
  if (isDirectoryPlaceholder(file, path, directoryNames)) {
    return;
  }

  const candidate: DroppedFile = { file, path };
  const key = buildDedupKey(candidate);
  if (!seen.has(key)) {
    seen.add(key);
    target.push(candidate);
  }
};

export const snapshotDropPayload = (dataTransfer: DataTransfer): DropSnapshot => {
  const droppedItems = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const droppedFiles = dataTransfer.files ? Array.from(dataTransfer.files) : [];

  const itemSnapshots: DropItemSnapshot[] = droppedItems
    .filter((item) => item.kind === "file")
    .map((item) => {
      const webkitItem = item as DataTransferItem & {
        webkitGetAsEntry?: () => LegacyFileSystemEntry | null;
      };

      return {
        entry: webkitItem.webkitGetAsEntry?.() ?? null,
        fallbackFile: item.getAsFile?.() ?? null,
      };
    });

  return {
    itemSnapshots,
    files: droppedFiles,
  };
};

export const collectDroppedFiles = async (snapshot: DropSnapshot): Promise<DroppedFile[]> => {
  const allFiles: DroppedFile[] = [];
  const seen = new Set<string>();

  const directoryNames = new Set<string>(
    snapshot.itemSnapshots
      .map((item) => item.entry)
      .filter((entry): entry is LegacyFileSystemDirectoryEntry => Boolean(entry && entry.isDirectory))
      .map((entry) => entry.name)
  );

  for (const item of snapshot.itemSnapshots) {
    const entry = item.entry;

    if (entry) {
      if (entry.isFile) {
        const file = await getFileFromEntry(entry);
        if (file) {
          appendIfValid(allFiles, file, directoryNames, seen);
          continue;
        }
      } else {
        const files = await readDirectory(entry, entry.name);
        for (const fileItem of files) {
          const key = buildDedupKey(fileItem);
          if (!seen.has(key)) {
            seen.add(key);
            allFiles.push(fileItem);
          }
        }
        continue;
      }
    }

    if (item.fallbackFile) {
      appendIfValid(allFiles, item.fallbackFile, directoryNames, seen);
    }
  }

  for (const file of snapshot.files) {
    appendIfValid(allFiles, file, directoryNames, seen);
  }

  return allFiles;
};

type CompressionProgress = {
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  currentPath: string;
};

const getTotalBytes = (files: DroppedFile[]): number => {
  return files.reduce((sum, item) => sum + item.file.size, 0);
};

export const createTarGzArchive = async (
  files: DroppedFile[],
  onProgress?: (progress: CompressionProgress) => void
): Promise<Blob> => {
  const chunks: Uint8Array[] = [];
  const totalFiles = files.length;
  const totalBytes = getTotalBytes(files);
  let processedBytes = 0;
  let processedFiles = 0;

  for (const { file, path } of files) {
    const content = new Uint8Array(await file.arrayBuffer());
    processedBytes += file.size;
    processedFiles += 1;
    if (onProgress) {
      onProgress({
        processedFiles,
        totalFiles,
        processedBytes,
        totalBytes,
        currentPath: path,
      });
    }
    const header = new Uint8Array(512);
    const nameBytes = strToU8(path);
    header.set(nameBytes.slice(0, 100), 0);
    header.set(strToU8("0000644"), 100);
    header.set(strToU8("0000000"), 108);
    header.set(strToU8("0000000"), 116);
    header.set(strToU8(content.length.toString(8).padStart(11, "0")), 124);
    header.set(strToU8(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")), 136);
    header.set(strToU8("        "), 148);
    header.set(strToU8("0"), 156);

    let checksum = 0;
    for (let index = 0; index < 512; index++) {
      checksum += header[index];
    }

    header.set(strToU8(checksum.toString(8).padStart(6, "0") + "\0 "), 148);
    chunks.push(header, content);

    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) {
      chunks.push(new Uint8Array(padding));
    }
  }

  chunks.push(new Uint8Array(1024));

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const tarData = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    tarData.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([gzipSync(tarData)]);
};

export type { DroppedFile, DropSnapshot, DropItemSnapshot, LegacyFileSystemEntry };
