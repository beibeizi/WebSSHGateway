import { API_BASE } from "./config";
import { getStoredLanguage, type AppLanguage } from "./i18n";

export type AuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">;

const CLIENT_TEXT_MAP: Record<string, { zh: string; en: string }> = {
  "网络连接失败，请检查网络": { zh: "网络连接失败，请检查网络", en: "Network request failed. Please check your connection." },
  "登录已过期，请重新登录": { zh: "登录已过期，请重新登录", en: "Login expired. Please sign in again." },
  "请求失败": { zh: "请求失败", en: "Request failed" },
  "请求失败，请稍后重试": { zh: "请求失败，请稍后重试", en: "Request failed. Please try again later." },
  "用户名或密码错误": { zh: "用户名或密码错误", en: "Invalid username or password" },
  "用户不存在": { zh: "用户不存在", en: "User not found" },
  "校验码错误或已过期": { zh: "校验码错误或已过期", en: "Verification code is invalid or expired" },
  "Web 端不支持重置密码，请联系管理员使用 CLI 重置密码": {
    zh: "Web 端不支持重置密码，请联系管理员使用 CLI 重置密码",
    en: "Password reset is not available on the web. Please contact an administrator to use the CLI reset command."
  },
  "修改失败": { zh: "修改失败", en: "Update failed" },
  "发送重置校验码失败": { zh: "发送重置校验码失败", en: "Failed to send password reset verification code" },
  "重置密码失败": { zh: "重置密码失败", en: "Failed to reset password" },
  "加载连接失败": { zh: "加载连接失败", en: "Failed to load connections" },
  "创建连接失败": { zh: "创建连接失败", en: "Failed to create connection" },
  "加载会话失败": { zh: "加载会话失败", en: "Failed to load sessions" },
  "创建会话失败": { zh: "创建会话失败", en: "Failed to create session" },
  "检测目标系统信息失败": { zh: "检测目标系统信息失败", en: "Failed to inspect target system info" },
  "重试连接失败": { zh: "重试连接失败", en: "Failed to retry connection" },
  "断开失败": { zh: "断开失败", en: "Failed to disconnect" },
  "保存备注失败": { zh: "保存备注失败", en: "Failed to save note" },
  "保存排序失败": { zh: "保存排序失败", en: "Failed to save order" },
  "删除会话失败": { zh: "删除会话失败", en: "Failed to delete session" },
  "删除连接失败": { zh: "删除连接失败", en: "Failed to delete connection" },
  "更新连接失败": { zh: "更新连接失败", en: "Failed to update connection" },
  "获取会话失败": { zh: "获取会话失败", en: "Failed to get session" },
  "获取系统状态失败": { zh: "获取系统状态失败", en: "Failed to get system stats" },
  "获取系统日志失败": { zh: "获取系统日志失败", en: "Failed to get system logs" },
  "获取网络状态失败": { zh: "获取网络状态失败", en: "Failed to get network stats" },
  "获取进程列表失败": { zh: "获取进程列表失败", en: "Failed to get process list" },
  "获取目录列表失败": { zh: "获取目录列表失败", en: "Failed to list directory" },
  "上传失败": { zh: "上传失败", en: "Upload failed" },
  "上传失败，请检查网络": { zh: "上传失败，请检查网络", en: "Upload failed. Please check your network." },
  "上传失败：响应格式无效": { zh: "上传失败：响应格式无效", en: "Upload failed: invalid response format" },
  "批量上传失败": { zh: "批量上传失败", en: "Batch upload failed" },
  "创建目录失败": { zh: "创建目录失败", en: "Failed to create directory" },
  "删除失败": { zh: "删除失败", en: "Delete failed" },
  "创建文件失败": { zh: "创建文件失败", en: "Failed to create file" },
  "重命名失败": { zh: "重命名失败", en: "Rename failed" },
  "修改权限失败": { zh: "修改权限失败", en: "Failed to change permissions" },
  "获取磁盘信息失败": { zh: "获取磁盘信息失败", en: "Failed to get disk info" },
  "获取系统概览失败": { zh: "获取系统概览失败", en: "Failed to get system overview" },
  "下载失败，请检查网络": { zh: "下载失败，请检查网络", en: "Download failed. Please check your network." },
  "下载失败": { zh: "下载失败", en: "Download failed" },
  "读取文件失败": { zh: "读取文件失败", en: "Failed to read file" },
  "保存文件失败": { zh: "保存文件失败", en: "Failed to save file" },
};

function localizeClientText(message: string, language: AppLanguage = getStoredLanguage()): string {
  const entry = CLIENT_TEXT_MAP[message];
  if (!entry) {
    return message;
  }
  return language === "en-US" ? entry.en : entry.zh;
}

function getValidationJoiner(language: AppLanguage): string {
  return language === "en-US" ? "; " : "；";
}

function getLanguageHeader(): Record<string, string> {
  return { "X-Language": getStoredLanguage() };
}

// 错误类型
export class NetworkError extends Error {
  constructor(message: string = localizeClientText("网络连接失败，请检查网络")) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthError extends Error {
  constructor(message: string = localizeClientText("登录已过期，请重新登录")) {
    super(message);
    this.name = "AuthError";
  }
}

export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}

const authStorage = {
  storage: localStorage as AuthStorage,
  setStorage(next: AuthStorage) {
    this.storage = next;
  },
  getItem(key: string) {
    return this.storage.getItem(key);
  },
  setItem(key: string, value: string) {
    this.storage.setItem(key, value);
  },
  removeItem(key: string) {
    this.storage.removeItem(key);
  },
  clear() {
    this.storage.clear();
  }
};

export function setAuthStorage(remember: boolean) {
  authStorage.setStorage(remember ? localStorage : sessionStorage);
}

export function clearAuthStorage() {
  localStorage.removeItem("token");
  localStorage.removeItem("user_id");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user_id");
}

export function getStoredToken(): string | null {
  return authStorage.getItem("token") || localStorage.getItem("token") || sessionStorage.getItem("token");
}

export function storeAuthData(token: string, userId: string, remember: boolean) {
  clearAuthStorage();
  setAuthStorage(remember);
  authStorage.setItem("token", token);
  authStorage.setItem("user_id", userId);
}

const HTTP_BASE = API_BASE || `${window.location.protocol}//${window.location.host}`;
const WS_BASE = API_BASE
  ? API_BASE.replace(/^http/, "ws")
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

export type LoginResponse = {
  access_token: string;
  expires_at: string;
  force_password_change: boolean;
};

export type PasswordResetRequestResponse = {
  status: string;
  expires_in_seconds: number;
};

export type Connection = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  created_at: string;
  updated_at: string;
};

export type Session = {
  id: string;
  connection_id: number;
  status: string;
  started_at: string;
  last_activity: string;
  host: string;
  username: string;
  name: string;
  note?: string | null;
  session_order?: number;
  enhanced_enabled?: boolean;
  remote_arch?: string | null;
  remote_os?: string | null;
  disconnected_at?: string | null;
  auto_retry_count?: number;
  retry_cycle_count?: number;
  allow_auto_retry?: boolean;
  target_profile?: "good" | "degraded" | "poor" | "unknown";
  target_rtt_ms?: number | null;
  target_avg_rtt_ms?: number | null;
  target_jitter_ms?: number;
  target_probe_error_streak?: number;
  target_measured_at?: string | null;
};

export type SessionPrepare = {
  connection_id: number;
  remote_arch: string;
  remote_os: string;
  supports_enhanced: boolean;
  first_time_enhance_available: boolean;
  should_prompt_enhance: boolean;
};

async function safeError(response: Response, fallback: string, handleAuth: boolean = true): Promise<string> {
  const language = getStoredLanguage();
  const localizedFallback = localizeClientText(fallback, language);
  if (handleAuth && (response.status === 401 || response.status === 403)) {
    clearAuthStorage();
    throw new AuthError();
  }
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      return localizeClientText(data.detail, language);
    }
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((item: { msg?: string }) => (item.msg ? localizeClientText(item.msg, language) : ""))
        .filter(Boolean)
        .join(getValidationJoiner(language)) || localizedFallback;
    }
  } catch {
    // ignore parse failures
  }
  return localizedFallback;
}

function getAuthHeader(): Record<string, string> {
  const token = getStoredToken();
  if (!token) {
    return getLanguageHeader();
  }
  return { ...getLanguageHeader(), Authorization: `Bearer ${token}` };
}

export async function login(username: string, password: string, rememberMe: boolean): Promise<LoginResponse> {
  const response = await fetch(`${HTTP_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getLanguageHeader() },
    body: JSON.stringify({ username, password, remember_me: rememberMe })
  });
  if (!response.ok) {
    const detail = await safeError(response, "用户名或密码错误", false);
    throw new Error(detail);
  }
  return response.json();
}

export async function changePassword(currentPassword: string, newPassword: string, confirmPassword: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword })
  });
  if (!response.ok) {
    const detail = await safeError(response, "修改失败");
    throw new Error(detail);
  }
}

export async function requestPasswordReset(username: string): Promise<PasswordResetRequestResponse> {
  const response = await fetch(`${HTTP_BASE}/auth/reset-password/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getLanguageHeader() },
    body: JSON.stringify({ username })
  });
  if (!response.ok) {
    const detail = await safeError(response, "发送重置校验码失败", false);
    throw new Error(detail);
  }
  return response.json();
}

export async function confirmPasswordReset(username: string, verificationCode: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/auth/reset-password/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getLanguageHeader() },
    body: JSON.stringify({ username, verification_code: verificationCode })
  });
  if (!response.ok) {
    const detail = await safeError(response, "重置密码失败", false);
    throw new Error(detail);
  }
}

export async function listConnections(): Promise<Connection[]> {
  const response = await fetch(`${HTTP_BASE}/connections`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "加载连接失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function createConnection(payload: {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  password?: string;
  private_key?: string;
}): Promise<Connection> {
  const response = await fetch(`${HTTP_BASE}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await safeError(response, "创建连接失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function listSessions(): Promise<Session[]> {
  const response = await fetch(`${HTTP_BASE}/sessions`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "加载会话失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function createSession(
  payload: { connection_id: number; rows: number; cols: number; enable_enhanced_persistence?: boolean },
  options?: { signal?: AbortSignal }
): Promise<Session> {
  const response = await fetch(`${HTTP_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ ...payload, term: "xterm-256color" }),
    signal: options?.signal,
  });
  if (!response.ok) {
    const detail = await safeError(response, "创建会话失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function prepareSession(connectionId: number, options?: { signal?: AbortSignal }): Promise<SessionPrepare> {
  const response = await fetch(`${HTTP_BASE}/sessions/prepare/${connectionId}`, {
    method: "POST",
    headers: { ...getAuthHeader() },
    signal: options?.signal,
  });
  if (!response.ok) {
    const detail = await safeError(response, "检测目标系统信息失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function retrySession(sessionId: string): Promise<Session> {
  const response = await fetch(`${HTTP_BASE}/sessions/${sessionId}/retry`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  if (!response.ok) {
    const detail = await safeError(response, "重试连接失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function disconnectSession(sessionId: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/sessions/${sessionId}/disconnect`, {
    method: "POST",
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "断开失败");
    throw new Error(detail);
  }
}

export async function updateSessionNote(sessionId: string, note: string | null): Promise<Session> {
  const response = await fetch(`${HTTP_BASE}/sessions/${sessionId}/note`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ note })
  });
  if (!response.ok) {
    const detail = await safeError(response, "保存备注失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function updateSessionOrder(orderedIds: string[]): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/sessions/order`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ ordered_ids: orderedIds })
  });
  if (!response.ok) {
    const detail = await safeError(response, "保存排序失败");
    throw new Error(detail);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "删除会话失败");
    throw new Error(detail);
  }
}

export async function deleteConnection(connectionId: number): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/connections/${connectionId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "删除连接失败");
    throw new Error(detail);
  }
}

export async function updateConnection(
  connectionId: number,
  payload: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    auth_type?: "password" | "private_key";
    password?: string;
    private_key?: string;
    key_passphrase?: string;
  }
): Promise<Connection> {
  const response = await fetch(`${HTTP_BASE}/connections/${connectionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await safeError(response, "更新连接失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getSession(sessionId: string): Promise<Session> {
  const response = await fetch(`${HTTP_BASE}/sessions/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取会话失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function pingServer(): Promise<number> {
  const start = performance.now();
  const response = await fetch(`${HTTP_BASE}/health`, {
    headers: { ...getAuthHeader() }
  });
  const latency = Math.round(performance.now() - start);
  if (!response.ok) {
    throw new Error("Ping failed");
  }
  return latency;
}

export function openSessionSocket(userId: number): WebSocket {
  const token = getStoredToken();
  const language = encodeURIComponent(getStoredLanguage());
  if (token) {
    return new WebSocket(`${WS_BASE}/sessions/ws/sessions/${userId}?token=${encodeURIComponent(token)}&lang=${language}`);
  }
  return new WebSocket(`${WS_BASE}/sessions/ws/sessions/${userId}?lang=${language}`);
}

export function openTerminalSocket(sessionId: string): WebSocket {
  const token = getStoredToken();
  const language = encodeURIComponent(getStoredLanguage());
  if (token) {
    return new WebSocket(`${WS_BASE}/sessions/ws/terminal/${sessionId}?token=${encodeURIComponent(token)}&lang=${language}`);
  }
  return new WebSocket(`${WS_BASE}/sessions/ws/terminal/${sessionId}?lang=${language}`);
}

// 系统监控相关类型
export type CpuInfo = {
  percent: number;
  count: number;
};

export type MemoryInfo = {
  total: number;
  used: number;
  percent: number;
};

export type SwapInfo = {
  total: number;
  used: number;
  percent: number;
};

export type NetworkInfo = {
  upload_speed: number;
  download_speed: number;
};

export type SystemStats = {
  cpu: CpuInfo;
  memory: MemoryInfo;
  swap: SwapInfo;
};

export type ProcessInfo = {
  pid: number;
  name: string;
  command: string;
  cpu_percent: number;
  memory_percent: number;
  memory_bytes: number;
};

export type ProcessList = {
  processes: ProcessInfo[];
};

export type FileInfo = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
  permissions: string;
  owner: string;
  group: string;
};

export type DirectoryListing = {
  path: string;
  files: FileInfo[];
};

export type DiskInfo = {
  mount: string;
  total: number;
  used: number;
  percent: number;
};

export type DiskList = {
  disks: DiskInfo[];
};

export type SystemOverview = {
  stats: SystemStats;
  network: NetworkInfo;
  processes: ProcessList;
  disks: DiskList;
};

export type SessionStatusSummary = {
  stats: SystemStats;
  network: NetworkInfo;
};

export type GlobalSystemSettings = {
  enhanced_retry_max_attempts: number;
  enhanced_retry_schedule_seconds: number[];
  session_status_refresh_interval_seconds: number;
  default_enable_enhanced_session: boolean;
  show_session_status_summary: boolean;
};

export type SystemLogEntry = {
  sequence: number;
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL" | string;
  logger: string;
  request_id: string;
  message: string;
  line: string;
};

export type SystemLogList = {
  entries: SystemLogEntry[];
  limit: number;
  level: string | null;
};

export async function getSystemStats(sessionId: string): Promise<SystemStats> {
  const response = await fetch(`${HTTP_BASE}/system/stats/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取系统状态失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getNetworkStats(sessionId: string): Promise<NetworkInfo> {
  const response = await fetch(`${HTTP_BASE}/system/network/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取网络状态失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getProcessList(sessionId: string): Promise<ProcessList> {
  const response = await fetch(`${HTTP_BASE}/system/processes/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取进程列表失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getSessionStatusSummary(sessionId: string): Promise<SessionStatusSummary> {
  const response = await fetch(`${HTTP_BASE}/system/session-status/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取会话系统状态失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getSystemLogs(options: { limit?: number; level?: string | null } = {}): Promise<SystemLogList> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 200));
  if (options.level) {
    params.set("level", options.level);
  }

  const response = await fetch(`${HTTP_BASE}/system/logs?${params.toString()}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取系统日志失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getSystemSettings(): Promise<GlobalSystemSettings> {
  const response = await fetch(`${HTTP_BASE}/system/settings`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取系统设置失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function updateSystemSettings(payload: GlobalSystemSettings): Promise<GlobalSystemSettings> {
  const response = await fetch(`${HTTP_BASE}/system/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await safeError(response, "保存系统设置失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function listDirectory(sessionId: string, path: string = "/"): Promise<DirectoryListing> {
  const response = await fetch(`${HTTP_BASE}/system/files/${sessionId}?path=${encodeURIComponent(path)}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取目录列表失败");
    throw new Error(detail);
  }
  return response.json();
}

export type UploadResult = {
  status: "ok";
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export type TransferProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

type UploadTargzOptions = {
  onProgress?: (progress: TransferProgress) => void;
};

type DownloadFileOptions = {
  onProgress?: (progress: TransferProgress) => void;
};

function buildTransferProgress(event: ProgressEvent): TransferProgress {
  const total = event.lengthComputable ? event.total : null;
  const percent = total && total > 0 ? Math.min(100, (event.loaded / total) * 100) : null;
  return {
    loaded: event.loaded,
    total,
    percent,
  };
}

async function parseXhrErrorDetail(responseText: string, fallback: string): Promise<string> {
  const language = getStoredLanguage();
  const localizedFallback = localizeClientText(fallback, language);
  if (!responseText) {
    return localizedFallback;
  }
  try {
    const parsed = JSON.parse(responseText) as { detail?: string | Array<{ msg?: string }> };
    if (typeof parsed.detail === "string") {
      return localizeClientText(parsed.detail, language);
    }
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((item) => (item.msg ? localizeClientText(item.msg, language) : ""))
        .filter(Boolean)
        .join(getValidationJoiner(language)) || localizedFallback;
    }
  } catch {
    // ignore parse failures
  }
  return localizedFallback;
}

export async function uploadFile(sessionId: string, path: string, file: File, compress: boolean): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${HTTP_BASE}/system/upload/${sessionId}?path=${encodeURIComponent(path)}&compress=${compress}`, {
    method: "POST",
    headers: { ...getAuthHeader() },
    body: formData
  });
  if (!response.ok) {
    const detail = await safeError(response, "上传失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function uploadTargz(
  sessionId: string,
  path: string,
  blob: Blob,
  filename: string = "upload.tar.gz",
  options?: UploadTargzOptions
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", blob, filename);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${HTTP_BASE}/system/upload-targz/${sessionId}?path=${encodeURIComponent(path)}`);

    const headers = getAuthHeader();
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      options?.onProgress?.(buildTransferProgress(event));
    };

    xhr.onerror = () => {
      reject(new NetworkError(localizeClientText("上传失败，请检查网络")));
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          reject(new Error(localizeClientText("上传失败：响应格式无效")));
        }
        return;
      }

      if (xhr.status === 401 || xhr.status === 403) {
        clearAuthStorage();
        reject(new AuthError());
        return;
      }

      const detail = await parseXhrErrorDetail(xhr.responseText, "上传失败");
      reject(new Error(detail));
    };

    xhr.send(formData);
  });
}

export async function uploadBatch(
  sessionId: string,
  path: string,
  files: Array<{ file: File; path: string }>,
  compress: boolean,
  concurrent: number = 3,
): Promise<UploadResult> {
  const formData = new FormData();
  for (const item of files) {
    formData.append("files", item.file, item.path);
  }

  const response = await fetch(
    `${HTTP_BASE}/system/upload-batch/${sessionId}?path=${encodeURIComponent(path)}&compress=${compress}&concurrent=${concurrent}`,
    {
      method: "POST",
      headers: { ...getAuthHeader() },
      body: formData,
    }
  );

  if (!response.ok) {
    const detail = await safeError(response, "批量上传失败");
    throw new Error(detail);
  }

  return response.json();
}

export async function mkdir(sessionId: string, path: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/system/mkdir/${sessionId}?path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  if (!response.ok) {
    const detail = await safeError(response, "创建目录失败");
    throw new Error(detail);
  }
}

export async function deletePath(sessionId: string, path: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/system/delete/${sessionId}?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  if (!response.ok) {
    const detail = await safeError(response, "删除失败");
    throw new Error(detail);
  }
}

export async function touchPath(sessionId: string, path: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/system/touch/${sessionId}?path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  if (!response.ok) {
    const detail = await safeError(response, "创建文件失败");
    throw new Error(detail);
  }
}

export async function renamePath(sessionId: string, oldPath: string, newPath: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/system/rename/${sessionId}?old_path=${encodeURIComponent(oldPath)}&new_path=${encodeURIComponent(newPath)}`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  if (!response.ok) {
    const detail = await safeError(response, "重命名失败");
    throw new Error(detail);
  }
}

export async function chmodPath(sessionId: string, path: string, mode: string, recursive: boolean): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/system/chmod/${sessionId}?path=${encodeURIComponent(path)}&mode=${encodeURIComponent(mode)}&recursive=${recursive}`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  if (!response.ok) {
    const detail = await safeError(response, "修改权限失败");
    throw new Error(detail);
  }
}

export async function getDiskList(sessionId: string): Promise<DiskList> {
  const response = await fetch(`${HTTP_BASE}/system/disks/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取磁盘信息失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function getSystemOverview(sessionId: string): Promise<SystemOverview> {
  const response = await fetch(`${HTTP_BASE}/system/overview/${sessionId}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "获取系统概览失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function downloadFile(sessionId: string, path: string, options?: DownloadFileOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${HTTP_BASE}/system/download/${sessionId}?path=${encodeURIComponent(path)}`);
    xhr.responseType = "blob";

    const headers = getAuthHeader();
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.onprogress = (event) => {
      options?.onProgress?.(buildTransferProgress(event));
    };

    xhr.onerror = () => {
      reject(new NetworkError(localizeClientText("下载失败，请检查网络")));
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as Blob);
        return;
      }

      if (xhr.status === 401 || xhr.status === 403) {
        clearAuthStorage();
        reject(new AuthError());
        return;
      }

      const responseBlob = xhr.response as Blob | null;
      const responseText = responseBlob ? await responseBlob.text() : "";
      const detail = await parseXhrErrorDetail(responseText, "下载失败");
      reject(new Error(detail));
    };

    xhr.send();
  });
}

export async function readFile(sessionId: string, path: string, force: boolean = false): Promise<{ content?: string; size: number; too_large?: boolean }> {
  const response = await fetch(`${HTTP_BASE}/system/file/${sessionId}?path=${encodeURIComponent(path)}&force=${force}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) {
    const detail = await safeError(response, "读取文件失败");
    throw new Error(detail);
  }
  return response.json();
}

export async function writeFile(sessionId: string, path: string, content: string): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/system/file/${sessionId}?path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ content })
  });
  if (!response.ok) {
    const detail = await safeError(response, "保存文件失败");
    throw new Error(detail);
  }
}
