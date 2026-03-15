import React from "react";
import { useToast } from "../../components/Toast";
import { useApp } from "../../context/AppContext";
import {
  Connection,
  Session,
  createConnection,
  createSession,
  deleteConnection,
  deleteSession,
  disconnectSession,
  listConnections,
  listSessions,
  prepareSession,
  retrySession,
  updateConnection,
  updateSessionNote,
} from "../../lib/api";
import { localizeText, normalizeTargetProfile, pickWorseProfile } from "./sessionsUtils";
import { useSessionsOrdering } from "./useSessionsOrdering";
import { useSessionsPolling } from "./useSessionsPolling";
import { usePasswordDialog } from "./usePasswordDialog";

export function useSessionsState() {
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
    key_passphrase: "",
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
    key_passphrase: "",
  });
  const [deleteConfirm, setDeleteConfirm] = React.useState<{
    type: "session" | "connection";
    id: string | number;
    name: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [connectingId, setConnectingId] = React.useState<number | null>(null);
  const [retryingSessionIds, setRetryingSessionIds] = React.useState<Record<string, boolean>>({});
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
  const passwordDialog = usePasswordDialog({ push, t });
  const sessionsRef = React.useRef<Session[]>([]);
  const draggingRef = React.useRef(false);

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

  const loadData = React.useCallback(async () => {
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
  }, [preserveOrderIfDragging, push, t]);

  React.useEffect(() => {
    loadData();
  }, [loadData, language]);

  React.useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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

  const filteredSessions = orderedSessions.filter((session) => {
    const matchStatus = filter === "all" || session.status === filter;
    const matchSearch = (session.name || "").toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const ordering = useSessionsOrdering({
    orderedSessions,
    filteredSessions,
    setSessions,
    loadData,
    push,
    t,
    draggingRef,
  });

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

  useSessionsPolling({
    sessionsPollIntervalMs,
    preserveOrderIfDragging,
    sessionsRef,
    setSessions,
    setNoteDrafts,
    push,
    t,
    reportNetworkHint,
  });

  const networkProfileLabel =
    effectiveNetworkProfile === "good"
      ? t("网络良好", "Network Good")
      : effectiveNetworkProfile === "degraded"
      ? t("网络波动", "Network Fluctuating")
      : t("弱网模式", "Poor Network Mode");
  const networkProfileTone =
    effectiveNetworkProfile === "good" ? "text-emerald-400" : effectiveNetworkProfile === "degraded" ? "text-amber-400" : "text-rose-400";

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
        key_passphrase: form.auth_type === "private_key" ? form.key_passphrase : undefined,
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
      key_passphrase: "",
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
        username: editForm.username,
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

  return {
    isDark,
    toggleTheme,
    toggleLanguage,
    language,
    t,
    connections,
    sessions,
    orderedSessions,
    filteredSessions,
    filter,
    setFilter,
    search,
    setSearch,
    loading,
    form,
    setForm,
    showCreateForm,
    setShowCreateForm,
    editingConnection,
    setEditingConnection,
    editForm,
    setEditForm,
    noteDrafts,
    handleNoteChange,
    handleSaveNote,
    deleteConfirm,
    setDeleteConfirm,
    deleteLoading,
    confirmDelete,
    ...passwordDialog,
    handleCreateConnection,
    handleUpdateConnection,
    handleEditConnection,
    handleCreateSession,
    connectingId,
    handleRetryEnhancedSession,
    retryingSessionIds,
    handleDisconnectOrDelete,
    enhancePrompt,
    setEnhancePrompt,
    handleConfirmEnhance,
    mapSessionStatus,
    isSystemRetrying,
    networkProfileLabel,
    networkProfileTone,
    ordering,
  };
}

export type SessionsState = ReturnType<typeof useSessionsState>;
