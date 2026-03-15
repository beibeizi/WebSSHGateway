import React from "react";
import { GripVertical } from "lucide-react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Input } from "../components/Input";
import { useToast } from "../components/Toast";
import { useApp } from "../context/AppContext";
import {
  Connection,
  Session,
  changePassword,
  clearAuthStorage,
  createConnection,
  createSession,
  deleteConnection,
  deleteSession,
  disconnectSession,
  listConnections,
  listSessions,
  openSessionSocket,
  prepareSession,
  retrySession,
  updateConnection,
  updateSessionNote,
  updateSessionOrder,
  getStoredToken
} from "../lib/api";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

const NETWORK_PROFILE_RANK: Record<"good" | "degraded" | "poor", number> = {
  good: 0,
  degraded: 1,
  poor: 2,
};

function pickWorseProfile(a: "good" | "degraded" | "poor", b: "good" | "degraded" | "poor"): "good" | "degraded" | "poor" {
  return NETWORK_PROFILE_RANK[a] >= NETWORK_PROFILE_RANK[b] ? a : b;
}

function normalizeTargetProfile(raw: string | undefined | null): "good" | "degraded" | "poor" | "unknown" {
  if (raw === "good" || raw === "degraded" || raw === "poor") {
    return raw;
  }
  return "unknown";
}

function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function mergeVisibleOrder(
  fullOrder: string[],
  visibleOrder: string[],
  nextVisibleOrder: string[]
): string[] {
  const visibleSet = new Set(visibleOrder);
  let visibleIndex = 0;
  return fullOrder.map((id) => {
    if (!visibleSet.has(id)) {
      return id;
    }
    const nextId = nextVisibleOrder[visibleIndex];
    visibleIndex += 1;
    return nextId;
  });
}

export function Sessions() {
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [filter, setFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    auth_type: "password" as "password" | "private_key",
    password: "",
    private_key: "",
    key_passphrase: ""
  });
  const [noteDrafts, setNoteDrafts] = React.useState<Record<string, string>>({});
  const [showCreateForm, setShowCreateForm] = React.useState(false);
  const [editingConnection, setEditingConnection] = React.useState<Connection | null>(null);
  const [editForm, setEditForm] = React.useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    auth_type: "password" as "password" | "private_key",
    password: "",
    private_key: "",
    key_passphrase: ""
  });
  const [deleteConfirm, setDeleteConfirm] = React.useState<{
    type: "session" | "connection";
    id: string | number;
    name: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [connectingId, setConnectingId] = React.useState<number | null>(null);
  const [retryingSessionIds, setRetryingSessionIds] = React.useState<Record<string, boolean>>({});
  const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false);
  const [passwordSaving, setPasswordSaving] = React.useState(false);
  const [passwordForm, setPasswordForm] = React.useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [draggingSessionId, setDraggingSessionId] = React.useState<string | null>(null);
  const [savingOrder, setSavingOrder] = React.useState(false);
  const [enhancePrompt, setEnhancePrompt] = React.useState<{
    open: boolean;
    connectionId: number;
    remoteArch: string;
    remoteOs: string;
    checked: boolean;
  } | null>(null);
  const { push } = useToast();
  const { isDark, toggleTheme, toggleLanguage, language, networkProfile, reportNetworkHint } = useApp();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const sessionPollInFlightRef = React.useRef(false);
  const sessionsRef = React.useRef<Session[]>([]);
  const draggingRef = React.useRef(false);
  const orderDirtyRef = React.useRef(false);
  const orderedIdsRef = React.useRef<string[]>([]);
  const targetOverviewProfile = React.useMemo<"good" | "degraded" | "poor" | "unknown">(() => {
    let current: "good" | "degraded" | "poor" | "unknown" = "unknown";
    for (const session of sessions) {
      const profile = normalizeTargetProfile(session.target_profile);
      if (profile === "unknown") {
        continue;
      }
      current = current === "unknown" ? profile : pickWorseProfile(current, profile);
    }
    return current;
  }, [sessions]);
  const effectiveNetworkProfile = React.useMemo<"good" | "degraded" | "poor">(() => {
    if (targetOverviewProfile === "unknown") {
      return networkProfile;
    }
    return pickWorseProfile(networkProfile, targetOverviewProfile);
  }, [networkProfile, targetOverviewProfile]);
  const sessionsPollIntervalMs =
    effectiveNetworkProfile === "poor" ? 25000 : effectiveNetworkProfile === "degraded" ? 15000 : 10000;
  const networkProfileLabel =
    effectiveNetworkProfile === "good"
      ? t("网络良好", "Network Good")
      : effectiveNetworkProfile === "degraded"
        ? t("网络波动", "Network Fluctuating")
        : t("弱网模式", "Poor Network Mode");
  const networkProfileTone = effectiveNetworkProfile === "good" ? "text-emerald-400" : effectiveNetworkProfile === "degraded" ? "text-amber-400" : "text-rose-400";
  const mapSessionStatus = React.useCallback(
    (status: string) => {
      if (status === "active") {
        return t("在线", "Active");
      }
      if (status === "disconnected") {
        return t("离线", "Disconnected");
      }
      return status;
    },
    [t]
  );

  const isSystemRetrying = React.useCallback((session: Session) => {
    return (
      session.enhanced_enabled === true
      && session.status !== "active"
      && session.allow_auto_retry !== false
      && (session.retry_cycle_count ?? 0) < 3
    );
  }, []);

  const preserveOrderIfDragging = React.useCallback((sessionList: Session[]) => {
    if (!draggingRef.current) {
      return sessionList;
    }
    const orderMap = new Map(sessionsRef.current.map((session) => [session.id, session.session_order]));
    return sessionList.map((session) => (
      orderMap.has(session.id)
        ? { ...session, session_order: orderMap.get(session.id) }
        : session
    ));
  }, []);

  const loadData = async () => {
    try {
      const [connectionList, sessionList] = await Promise.all([listConnections(), listSessions()]);
      setConnections(connectionList);
      setSessions(preserveOrderIfDragging(sessionList));
      setNoteDrafts((prev) => {
        const next = { ...prev };
        sessionList.forEach((session) => {
          if (!(session.id in next)) {
            next[session.id] = session.note ?? "";
          }
        });
        return next;
      });
    } catch (error) {
      push(error instanceof Error ? error.message : t("加载失败", "Failed to load data"));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadData();
  }, [language]);

  React.useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 定期刷新会话状态（根据网络质量动态降频）
  React.useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      timer = window.setTimeout(run, sessionsPollIntervalMs);
    };

    const run = async () => {
      if (sessionPollInFlightRef.current) {
        scheduleNext();
        return;
      }
      sessionPollInFlightRef.current = true;
      try {
        const sessionList = await listSessions();
        setSessions(preserveOrderIfDragging(sessionList));
        // 同步更新 noteDrafts 中已存在且未被本地修改的备注
        setNoteDrafts((prev) => {
          const previousSessions = sessionsRef.current;
          const next = { ...prev };
          sessionList.forEach((session) => {
            if (!(session.id in next)) {
              next[session.id] = session.note ?? "";
              return;
            }
            const previousSession = previousSessions.find((item) => item.id === session.id);
            if (next[session.id] === (previousSession?.note ?? "")) {
              next[session.id] = session.note ?? "";
            }
          });
          return next;
        });
      } catch {
        // 静默处理刷新错误
      } finally {
        sessionPollInFlightRef.current = false;
        scheduleNext();
      }
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionsPollIntervalMs]);

  React.useEffect(() => {
    const userId = localStorage.getItem("user_id") || sessionStorage.getItem("user_id");
    const token = getStoredToken();
    if (!userId || !token) {
      clearAuthStorage();
      window.location.href = "/";
      return;
    }
    const socket = openSessionSocket(Number(userId));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Partial<Session> & { status?: string };
        if (payload.id && payload.status === "deleted") {
          setSessions((prev) => prev.filter((item) => item.id !== payload.id));
          return;
        }
        setSessions((prev) => {
          const existing = prev.find((item) => item.id === payload.id);
          if (existing) {
            return prev.map((item) => (item.id === payload.id ? { ...item, ...payload } as Session : item));
          }
          if (payload.id) {
            return [...prev, payload as Session];
          }
          return prev;
        });
        if (payload.id && "note" in payload) {
          setNoteDrafts((prev) => ({ ...prev, [payload.id as string]: payload.note ?? "" }));
        }
      } catch {
        // ignore malformed payloads
      }
    };
    let warned = false;
    socket.onerror = () => {
      if (!warned) {
        push(t("会话状态连接失败", "Session status connection failed"));
        warned = true;
      }
      reportNetworkHint("degraded", 15000);
    };
    socket.onclose = (event) => {
      if (!event.wasClean && !warned) {
        push(t("会话状态连接已断开", "Session status connection closed"));
        warned = true;
      }
      if (!event.wasClean) {
        reportNetworkHint("poor", 25000);
      }
    };
    return () => socket.close();
  }, [push, reportNetworkHint, t]);

  const orderedSessions = React.useMemo(() => {
    const normalizeOrder = (value?: number) => (value && value > 0 ? value : Number.MAX_SAFE_INTEGER);
    return [...sessions].sort((a, b) => {
      const orderA = normalizeOrder(a.session_order);
      const orderB = normalizeOrder(b.session_order);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
    });
  }, [sessions]);

  React.useEffect(() => {
    orderedIdsRef.current = orderedSessions.map((session) => session.id);
  }, [orderedSessions]);

  const filteredSessions = orderedSessions.filter((session) => {
    const matchStatus = filter === "all" || session.status === filter;
    const matchSearch = (session.name || "").toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const handleCreateConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || !form.host || !form.username) {
      push(t("请填写完整连接信息", "Please fill in all required connection fields"));
      return;
    }
    try {
      const payload = {
        name: form.name,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        auth_type: form.auth_type,
        password: form.auth_type === "password" ? form.password : undefined,
        private_key: form.auth_type === "private_key" ? form.private_key : undefined,
        key_passphrase: form.auth_type === "private_key" ? form.key_passphrase : undefined
      };
      await createConnection(payload);
      push(t("连接已保存", "Connection saved"));
      setForm({ name: "", host: "", port: 22, username: "", auth_type: "password", password: "", private_key: "", key_passphrase: "" });
      setShowCreateForm(false);
      loadData();
    } catch (error) {
      push(error instanceof Error ? error.message : t("创建失败", "Create failed"));
    }
  };

  const createSessionWithOption = async (
    connectionId: number,
    signal: AbortSignal,
    enableEnhancedPersistence: boolean
  ) => {
    const session = await createSession(
      {
        connection_id: connectionId,
        rows: 24,
        cols: 80,
        enable_enhanced_persistence: enableEnhancedPersistence,
      },
      { signal }
    );
    push(t("会话已启动", "Session started"));
    window.open(`/terminal/${session.id}`, "_blank");
    await loadData();
  };

  const handleCreateSession = async (connectionId: number) => {
    setConnectingId(connectionId);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);

    try {
      const prepared = await prepareSession(connectionId, { signal: controller.signal });
      if (prepared.should_prompt_enhance) {
        setEnhancePrompt({
          open: true,
          connectionId,
          remoteArch: prepared.remote_arch,
          remoteOs: prepared.remote_os,
          checked: false,
        });
        clearTimeout(timeoutId);
        setConnectingId(null);
        return;
      }

      await createSessionWithOption(connectionId, controller.signal, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        push(t("连接超时，请检查与目标机器网络是否通畅", "Connection timeout. Please verify network reachability to the target host."));
      } else {
        push(error instanceof Error ? error.message : t("启动失败", "Start failed"));
      }
    } finally {
      clearTimeout(timeoutId);
      setConnectingId(null);
    }
  };

  const handleConfirmEnhance = async () => {
    if (!enhancePrompt) {
      return;
    }
    const { connectionId, checked } = enhancePrompt;
    setEnhancePrompt(null);
    setConnectingId(connectionId);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);

    try {
      await createSessionWithOption(connectionId, controller.signal, checked);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        push(t("连接超时，请检查与目标机器网络是否通畅", "Connection timeout. Please verify network reachability to the target host."));
      } else {
        push(error instanceof Error ? error.message : t("启动失败", "Start failed"));
      }
    } finally {
      clearTimeout(timeoutId);
      setConnectingId(null);
    }
  };

  const handleRetryEnhancedSession = async (sessionId: string) => {
    if (retryingSessionIds[sessionId]) {
      return;
    }
    setRetryingSessionIds((prev) => ({ ...prev, [sessionId]: true }));
    try {
      await retrySession(sessionId);
      push(t("重试连接已发起", "Retry request started"));
      await loadData();
    } catch (error) {
      push(error instanceof Error ? error.message : t("重试失败", "Retry failed"));
    } finally {
      setRetryingSessionIds((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }
  };

  const handleDisconnectOrDelete = async (session: Session) => {
    if (session.status === "active") {
      if (!confirm(t("断开后此会话后台正在执行的程序会停止运行，确定要断开吗？", "Disconnecting will stop running processes in this session. Continue?"))) {
        return;
      }
      try {
        await disconnectSession(session.id);
        push(t("会话已断开", "Session disconnected"));
        loadData();
      } catch (error) {
        push(error instanceof Error ? error.message : t("断开失败", "Disconnect failed"));
      }
    } else {
      setDeleteConfirm({ type: "session", id: session.id, name: session.name });
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setDeleteLoading(true);
    try {
      await deleteSession(sessionId);
      push(t("会话已删除", "Session deleted"));
      loadData();
    } catch (error) {
      push(error instanceof Error ? error.message : t("删除失败", "Delete failed"));
    } finally {
      setDeleteLoading(false);
      setDeleteConfirm(null);
    }
  };

  const handleDeleteConnection = async (connectionId: number) => {
    setDeleteLoading(true);
    try {
      await deleteConnection(connectionId);
      push(t("连接已删除", "Connection deleted"));
      loadData();
    } catch (error) {
      push(error instanceof Error ? error.message : t("删除失败", "Delete failed"));
    } finally {
      setDeleteLoading(false);
      setDeleteConfirm(null);
    }
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "session") {
      handleDeleteSession(deleteConfirm.id as string);
    } else {
      handleDeleteConnection(deleteConfirm.id as number);
    }
  };

  const handleEditConnection = (conn: Connection) => {
    setEditingConnection(conn);
    setEditForm({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      auth_type: conn.auth_type as "password" | "private_key",
      password: "",
      private_key: "",
      key_passphrase: ""
    });
  };

  const handleUpdateConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingConnection) return;
    try {
      const payload: Parameters<typeof updateConnection>[1] = {
        name: editForm.name,
        host: editForm.host,
        port: Number(editForm.port),
        username: editForm.username
      };
      if (editForm.password || editForm.private_key || editForm.key_passphrase) {
        payload.auth_type = editForm.auth_type;
        payload.password = editForm.auth_type === "password" ? editForm.password : undefined;
        payload.private_key = editForm.auth_type === "private_key" ? editForm.private_key : undefined;
        payload.key_passphrase = editForm.auth_type === "private_key" ? editForm.key_passphrase : undefined;
      }
      await updateConnection(editingConnection.id, payload);
      push(t("连接已更新", "Connection updated"));
      setEditingConnection(null);
      loadData();
    } catch (error) {
      push(error instanceof Error ? error.message : t("更新失败", "Update failed"));
    }
  };

  const handleNoteChange = (sessionId: string, value: string) => {
    setNoteDrafts((prev) => ({ ...prev, [sessionId]: value }));
  };

  const handleSaveNote = async (session: Session) => {
    try {
      const note = (noteDrafts[session.id] ?? "").trim();
      const response = await updateSessionNote(session.id, note.length > 0 ? note : null);
      setSessions((prev) => prev.map((item) => (item.id === response.id ? { ...item, ...response } : item)));
      setNoteDrafts((prev) => ({ ...prev, [session.id]: response.note ?? "" }));
      push(t("备注已保存", "Note saved"));
    } catch (error) {
      push(error instanceof Error ? error.message : t("保存失败", "Save failed"));
    }
  };

  const applySessionOrder = React.useCallback((orderedIds: string[]) => {
    orderedIdsRef.current = orderedIds;
    const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));
    setSessions((prev) => prev.map((session) => (
      orderMap.has(session.id)
        ? { ...session, session_order: orderMap.get(session.id) }
        : session
    )));
  }, []);

  const handleDragStart = (sessionId: string, event: React.DragEvent<HTMLButtonElement>) => {
    if (savingOrder) {
      event.preventDefault();
      return;
    }
    draggingRef.current = true;
    orderDirtyRef.current = false;
    setDraggingSessionId(sessionId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sessionId);
  };

  const handleDragOver = (sessionId: string, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingSessionId || draggingSessionId === sessionId) {
      return;
    }
    event.preventDefault();
    const visibleOrderIds = filteredSessions.map((session) => session.id);
    if (!visibleOrderIds.includes(draggingSessionId) || !visibleOrderIds.includes(sessionId)) {
      return;
    }
    const fromIndex = visibleOrderIds.indexOf(draggingSessionId);
    const toIndex = visibleOrderIds.indexOf(sessionId);
    if (fromIndex === toIndex) {
      return;
    }
    const nextVisibleOrder = moveItem(visibleOrderIds, fromIndex, toIndex);
    const nextFullOrder = mergeVisibleOrder(orderedIdsRef.current, visibleOrderIds, nextVisibleOrder);
    applySessionOrder(nextFullOrder);
    orderDirtyRef.current = true;
  };

  const handleDragEnd = async () => {
    draggingRef.current = false;
    setDraggingSessionId(null);
    if (!orderDirtyRef.current) {
      return;
    }
    orderDirtyRef.current = false;
    setSavingOrder(true);
    try {
      await updateSessionOrder(orderedIdsRef.current);
      push(t("排序已保存", "Order saved"));
    } catch (error) {
      push(error instanceof Error ? error.message : t("保存失败", "Save failed"));
      await loadData();
    } finally {
      setSavingOrder(false);
    }
  };

  const resetPasswordForm = React.useCallback(() => {
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }, []);

  const handleClosePasswordDialog = React.useCallback(() => {
    if (passwordSaving) {
      return;
    }
    setPasswordDialogOpen(false);
    resetPasswordForm();
  }, [passwordSaving, resetPasswordForm]);

  const handleSubmitPasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      push(t("请完整填写密码信息", "Please complete all password fields"));
      return;
    }
    setPasswordSaving(true);
    try {
      await changePassword(
        passwordForm.currentPassword,
        passwordForm.newPassword,
        passwordForm.confirmPassword,
      );
      push(t("密码已更新", "Password updated"));
      setPasswordDialogOpen(false);
      resetPasswordForm();
    } catch (error) {
      push(error instanceof Error ? error.message : t("修改失败", "Update failed"));
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return <div className={`p-6 ${isDark ? "text-slate-200" : "text-slate-700"}`}>{t("加载中...", "Loading...")}</div>;
  }

  return (
    <div className={`min-h-screen px-6 py-8 transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className="mx-auto max-w-6xl space-y-8">
        <div className={`flex items-center justify-between pb-6 ${isDark ? "border-b border-slate-700" : "border-b border-slate-200"}`}>
          <div>
            <h1 className="text-2xl font-semibold">{t("会话管理", "Session Management")}</h1>
            <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("管理 SSH 连接与持久在线会话", "Manage SSH connections and persistent sessions")}
              <a
                href="https://github.com/beibeizi/WebSSHGateway"
                target="_blank"
                rel="noreferrer"
                className={`ml-2 inline-flex items-center gap-2 align-middle ${
                  isDark ? "text-slate-300 hover:text-slate-200" : "text-slate-600 hover:text-slate-700"
                }`}
                aria-label={t("打开 GitHub 仓库", "Open GitHub repository")}
                title={t("打开 GitHub 仓库", "Open GitHub repository")}
              >
                <img
                  src="https://img.shields.io/github/stars/beibeizi/WebSSHGateway?style=social"
                  alt={t("GitHub Star 数", "GitHub stars")}
                  className="h-4"
                  loading="lazy"
                />
              </a>
            </p>
            <p className={`text-xs mt-1 ${networkProfileTone}`}>{networkProfileLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              lightMode={!isDark}
              onClick={toggleLanguage}
            >
              {language === "en-US" ? "中文" : "EN"}
            </Button>
            <Button
              variant="ghost"
              lightMode={!isDark}
              onClick={toggleTheme}
            >
              {isDark ? t("浅色", "Light") : t("深色", "Dark")}
            </Button>
            <Button
              variant="secondary"
              lightMode={!isDark}
              onClick={() => setPasswordDialogOpen(true)}
            >
              {t("修改密码", "Change password")}
            </Button>
            <Button
              variant="ghost"
              lightMode={!isDark}
              onClick={() => {
                clearAuthStorage();
                window.location.href = "/";
              }}
            >
              {t("退出登录", "Sign out")}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder={t("搜索会话名称", "Search session name")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={`max-w-xs ${isDark ? "" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
              />
              <div className="flex gap-2">
                {[
                  { value: "all", label: t("全部", "All") },
                  { value: "active", label: t("在线", "Active") },
                  { value: "disconnected", label: t("离线", "Disconnected") }
                ].map((item) => (
                  <Button
                    key={item.value}
                    variant={filter === item.value ? "primary" : "secondary"}
                    lightMode={!isDark}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              {filteredSessions.map((session) => {
                const noteValue = noteDrafts[session.id] ?? "";
                return (
                  <div
                    key={session.id}
                    onDragOver={(event) => handleDragOver(session.id, event)}
                    onDrop={(event) => event.preventDefault()}
                    className={`rounded-lg border p-4 ${isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white shadow-sm"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          draggable={!savingOrder}
                          onDragStart={(event) => handleDragStart(session.id, event)}
                          onDragEnd={handleDragEnd}
                          disabled={savingOrder}
                          aria-label={t("拖动调整排序", "Drag to reorder")}
                          title={t("拖动调整排序", "Drag to reorder")}
                          className={`rounded-md border p-2 transition ${
                            isDark
                              ? "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
                              : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                          } ${savingOrder ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing"}`}
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <div className="space-y-1">
                          <p className="text-lg font-semibold">{session.name}</p>
                          <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            {session.username}@{session.host}
                          </p>
                          <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>{t("状态", "Status")}: {mapSessionStatus(session.status)}</p>
                          {session.enhanced_enabled ? (
                            <p className={`text-xs font-medium ${isDark ? "text-indigo-300" : "text-indigo-600"}`}>
                              {t("增强持久化连接", "Enhanced persistent connection")}
                            </p>
                          ) : null}
                          <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>{t("创建时间", "Created at")}: {new Date(session.started_at).toLocaleString()}</p>
                          <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>{t("最近活动", "Last activity")}: {new Date(session.last_activity).toLocaleString()}</p>
                          {session.disconnected_at ? (
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {t("断开时间", "Disconnected at")}: {new Date(session.disconnected_at).toLocaleString()}
                            </p>
                          ) : null}
                          {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {t("本轮重试", "Retry cycle")}: {session.retry_cycle_count ?? 0}/3
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {session.status === "active" ? (
                          <Button variant="secondary" lightMode={!isDark} onClick={() => window.open(`/terminal/${session.id}`, "_blank")}>
                            {t("打开会话", "Open session")}
                          </Button>
                        ) : null}
                        {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
                          <Button
                            variant="secondary"
                            lightMode={!isDark}
                            loading={isSystemRetrying(session) || !!retryingSessionIds[session.id]}
                            onClick={() => handleRetryEnhancedSession(session.id)}
                          >
                            {t("重试连接", "Retry")}
                          </Button>
                        ) : null}
                        <Button variant="ghost" lightMode={!isDark} onClick={() => handleDisconnectOrDelete(session)}>
                          {session.status === "active" ? t("断开", "Disconnect") : t("删除", "Delete")}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      <Input
                        placeholder={t("备注", "Note")}
                        value={noteValue}
                        maxLength={1000}
                        onChange={(event) => handleNoteChange(session.id, event.target.value)}
                        className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                      />
                      <div className={`flex items-center justify-between text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        <span>{t("最多 1000 字", "Up to 1000 characters")}</span>
                        {noteValue.trim() !== (session.note ?? "") ? (
                          <Button
                            variant="secondary"
                            lightMode={!isDark}
                            onClick={() => handleSaveNote(session)}
                          >
                            {t("保存备注", "Save note")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredSessions.length === 0 ? (
                <div className={`text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>{t("暂无会话", "No sessions")}</div>
              ) : null}
            </div>
          </div>

          <Card title={t("新增 SSH 连接", "New SSH Connection")} description={t("保存连接信息并发起会话", "Save connection details and start sessions")} className={!isDark ? "bg-white border-slate-200 shadow-sm" : ""} titleClassName={!isDark ? "text-slate-900" : ""} descClassName={!isDark ? "text-slate-500" : ""}>
            <div className="space-y-4">
              <Button
                variant={showCreateForm ? "secondary" : "primary"}
                lightMode={!isDark}
                onClick={() => setShowCreateForm((prev) => !prev)}
                className="w-full"
              >
                {showCreateForm ? t("收起表单", "Hide form") : t("新增连接", "New connection")}
              </Button>
              {showCreateForm ? (
                <form className="space-y-4" onSubmit={handleCreateConnection}>
                  <div
                    className={`rounded-md border px-3 py-2 text-sm ${
                      isDark
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {t(
                      "请确保该项目所运行的机器可以访问到目标连接。",
                      "Make sure the machine running this project can reach the target connection."
                    )}
                  </div>
                  <Input
                    placeholder={t("连接名称", "Connection name")}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                  />
                  <Input
                    placeholder={t("主机 IP", "Host IP")}
                    value={form.host}
                    onChange={(event) => setForm({ ...form, host: event.target.value })}
                    className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                  />
                  <Input
                    placeholder={t("端口", "Port")}
                    type="number"
                    value={form.port}
                    onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
                    className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                  />
                  <Input
                    placeholder={t("用户名", "Username")}
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={form.auth_type === "password" ? "primary" : "secondary"}
                      lightMode={!isDark}
                      onClick={() => setForm({ ...form, auth_type: "password" })}
                    >
                      {t("密码", "Password")}
                    </Button>
                    <Button
                      type="button"
                      variant={form.auth_type === "private_key" ? "primary" : "secondary"}
                      lightMode={!isDark}
                      onClick={() => setForm({ ...form, auth_type: "private_key" })}
                    >
                      {t("私钥", "Private key")}
                    </Button>
                  </div>
                  {form.auth_type === "password" ? (
                    <Input
                      placeholder={t("密码", "Password")}
                      type="password"
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                    />
                  ) : (
                    <>
                      <textarea
                        className={`min-h-[120px] w-full rounded-md border px-3 py-2 text-sm ${isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                        placeholder={t("私钥内容", "Private key content")}
                        value={form.private_key}
                        onChange={(event) => setForm({ ...form, private_key: event.target.value })}
                      />
                      <Input
                        placeholder={t("私钥密码（可选）", "Private key passphrase (optional)")}
                        type="password"
                        value={form.key_passphrase}
                        onChange={(event) => setForm({ ...form, key_passphrase: event.target.value })}
                        className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                      />
                    </>
                  )}
                  <Button type="submit" lightMode={!isDark} className="w-full">
                    {t("保存连接", "Save connection")}
                  </Button>
                </form>
              ) : null}
            </div>
            <div className={`mt-6 pt-6 space-y-3 ${isDark ? "border-t border-slate-700" : "border-t border-slate-200"}`}>
              <p className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>{t("已保存连接", "Saved connections")}</p>
              {connections.map((conn) => (
                <div key={conn.id} className={`rounded-md border p-3 text-sm ${isDark ? "border-slate-700 bg-slate-900/60 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                  {editingConnection?.id === conn.id ? (
                    <form className="space-y-3" onSubmit={handleUpdateConnection}>
                      <Input
                        placeholder={t("连接名称", "Connection name")}
                        value={editForm.name}
                        onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                        className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                      />
                      <Input
                        placeholder={t("主机 IP", "Host IP")}
                        value={editForm.host}
                        onChange={(event) => setEditForm({ ...editForm, host: event.target.value })}
                        className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                      />
                      <Input
                        placeholder={t("端口", "Port")}
                        type="number"
                        value={editForm.port}
                        onChange={(event) => setEditForm({ ...editForm, port: Number(event.target.value) })}
                        className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                      />
                      <Input
                        placeholder={t("用户名", "Username")}
                        value={editForm.username}
                        onChange={(event) => setEditForm({ ...editForm, username: event.target.value })}
                        className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={editForm.auth_type === "password" ? "primary" : "secondary"}
                          lightMode={!isDark}
                          onClick={() => setEditForm({ ...editForm, auth_type: "password" })}
                        >
                          {t("密码", "Password")}
                        </Button>
                        <Button
                          type="button"
                          variant={editForm.auth_type === "private_key" ? "primary" : "secondary"}
                          lightMode={!isDark}
                          onClick={() => setEditForm({ ...editForm, auth_type: "private_key" })}
                        >
                          {t("私钥", "Private key")}
                        </Button>
                      </div>
                      <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>{t("留空则保持原凭据不变", "Leave empty to keep original credentials")}</p>
                      {editForm.auth_type === "password" ? (
                        <Input
                          placeholder={t("新密码（可选）", "New password (optional)")}
                          type="password"
                          value={editForm.password}
                          onChange={(event) => setEditForm({ ...editForm, password: event.target.value })}
                          className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                        />
                      ) : (
                        <>
                          <textarea
                            className={`min-h-[80px] w-full rounded-md border px-3 py-2 text-sm ${isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                            placeholder={t("新私钥（可选）", "New private key (optional)")}
                            value={editForm.private_key}
                            onChange={(event) => setEditForm({ ...editForm, private_key: event.target.value })}
                          />
                          <Input
                            placeholder={t("私钥密码（可选）", "Private key passphrase (optional)")}
                            type="password"
                            value={editForm.key_passphrase}
                            onChange={(event) => setEditForm({ ...editForm, key_passphrase: event.target.value })}
                            className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                          />
                        </>
                      )}
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" lightMode={!isDark}>
                          {t("保存", "Save")}
                        </Button>
                        <Button type="button" variant="ghost" lightMode={!isDark} onClick={() => setEditingConnection(null)}>
                          {t("取消", "Cancel")}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className={`text-base font-semibold ${isDark ? "text-slate-100" : "text-slate-800"}`}>{conn.name}</p>
                        <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {conn.username}@{conn.host}:{conn.port}
                        </p>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          {t("创建", "Created")}: {new Date(conn.created_at).toLocaleString()} | {t("更新", "Updated")}: {new Date(conn.updated_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          lightMode={!isDark}
                          loading={connectingId === conn.id}
                          disabled={connectingId !== null}
                          onClick={() => handleCreateSession(conn.id)}
                        >
                          {t("创建新的连接", "Create new connection")}
                        </Button>
                        <Button variant="ghost" lightMode={!isDark} onClick={() => handleEditConnection(conn)}>
                          {t("编辑", "Edit")}
                        </Button>
                        <Button variant="ghost" lightMode={!isDark} onClick={() => setDeleteConfirm({ type: "connection", id: conn.id, name: conn.name })}>
                          {t("删除", "Delete")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={deleteConfirm?.type === "session" ? t("删除会话", "Delete session") : t("删除连接", "Delete connection")}
        message={t(`确定要删除 "${deleteConfirm?.name ?? ""}" 吗？此操作不可撤销。`, `Are you sure you want to delete "${deleteConfirm?.name ?? ""}"? This action cannot be undone.`)}
        confirmText={t("删除", "Delete")}
        variant="danger"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />

      {passwordDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className={`w-full max-w-md rounded-xl border p-6 shadow-xl ${isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <h3 className="mb-2 text-lg font-semibold">{t("修改密码", "Change password")}</h3>
            <p className={`mb-4 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("请输入当前密码，并设置新的登录密码。", "Enter your current password and set a new login password.")}
            </p>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("当前密码", "Current password")}</label>
                <Input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                  className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </div>
              <div className="space-y-2">
                <label className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("新密码", "New password")}</label>
                <Input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                  className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </div>
              <div className="space-y-2">
                <label className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("确认新密码", "Confirm new password")}</label>
                <Input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                  className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                lightMode={!isDark}
                onClick={handleClosePasswordDialog}
                disabled={passwordSaving}
              >
                {t("取消", "Cancel")}
              </Button>
              <Button
                variant="primary"
                lightMode={!isDark}
                loading={passwordSaving}
                onClick={handleSubmitPasswordChange}
              >
                {t("确认修改", "Confirm change")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {enhancePrompt?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className={`w-full max-w-lg rounded-xl border p-6 ${isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <h3 className="text-lg font-semibold mb-2">{t("是否开启增强持久化连接", "Enable enhanced persistent connection?")}</h3>
            <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("目标系统", "Target system")}: {enhancePrompt.remoteOs} / {enhancePrompt.remoteArch}
            </p>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input
                type="checkbox"
                checked={enhancePrompt.checked}
                onChange={(event) =>
                  setEnhancePrompt((prev) => (prev ? { ...prev, checked: event.target.checked } : prev))
                }
              />
              <span>{t("开启增强持久化连接", "Enable enhanced persistent connection")}</span>
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs cursor-help ${isDark ? "bg-slate-700 text-slate-200" : "bg-slate-200 text-slate-700"}`}
                title={t(
                  "普通连接的可靠性由项目所在机器和目标之间的网络决定。开启此功能会向目标机器搭建 tmux 通道，防止网络波动造成的连接断开。",
                  "The reliability of a normal connection depends on the network between the project host and the target. This feature creates a tmux channel on the target host to reduce disconnects caused by network fluctuations."
                )}
              >
                ?
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                lightMode={!isDark}
                onClick={() => {
                  setEnhancePrompt(null);
                  setConnectingId(null);
                }}
              >
                {t("取消", "Cancel")}
              </Button>
              <Button variant="primary" lightMode={!isDark} onClick={handleConfirmEnhance}>
                {t("确认连接", "Confirm connection")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
