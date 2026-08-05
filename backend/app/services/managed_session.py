from __future__ import annotations

import json
import logging
import shlex
from dataclasses import dataclass, field
from datetime import datetime

import asyncssh
from fastapi import WebSocket

from app.core.db import utc_now
from app.services.enhanced_session import close_ssh_resources
from app.services.types import SessionBuffer


logger = logging.getLogger(__name__)


@dataclass
class ManagedSession:
    session_id: str
    connection_id: int
    user_id: int
    client: asyncssh.SSHClientConnection
    channel: asyncssh.SSHClientChannel | None
    buffer: SessionBuffer
    last_activity: datetime
    websockets: set[WebSocket] = field(default_factory=set)
    status: str = "active"
    enhanced_enabled: bool = False
    enhanced_fingerprint: str | None = None
    tmux_binary_path: str | None = None
    resize_seq: int = 0
    target_profile: str = "unknown"
    target_rtt_ms: int | None = None
    target_avg_rtt_ms: int | None = None
    target_jitter_ms: int = 0
    target_probe_error_streak: int = 0
    target_measured_at: datetime | None = None
    target_rtt_samples: list[int] = field(default_factory=list)

    def status_payload(self) -> str:
        return json.dumps(
            {
                "id": self.session_id,
                "status": self.status,
                "last_activity": self.last_activity.isoformat(),
                "target_profile": self.target_profile,
                "target_rtt_ms": self.target_rtt_ms,
                "target_avg_rtt_ms": self.target_avg_rtt_ms,
                "target_jitter_ms": self.target_jitter_ms,
                "target_probe_error_streak": self.target_probe_error_streak,
                "target_measured_at": self.target_measured_at.isoformat() if self.target_measured_at else None,
            }
        )

    async def send(self, data: str) -> None:
        if not self.channel:
            return
        try:
            self.channel.write(data)
        except Exception:
            self.status = "disconnected"
            self.last_activity = utc_now()
            raise
        self.last_activity = utc_now()

    async def _collect_tmux_metrics(self, phase: str, expected_rows: int, expected_cols: int) -> None:
        if not (self.enhanced_enabled and self.enhanced_fingerprint and self.tmux_binary_path):
            return
        quoted_remote_binary = shlex.quote(self.tmux_binary_path)
        quoted_fingerprint = shlex.quote(self.enhanced_fingerprint)
        target_window = shlex.quote(f"{self.enhanced_fingerprint}:0")
        target_pane = shlex.quote(f"{self.enhanced_fingerprint}:0.0")
        try:
            pane_res = await self.client.run(
                f'{quoted_remote_binary} display-message -p -t {target_pane} "pane=#{{pane_height}}x#{{pane_width}} window=#{{window_height}}x#{{window_width}}"',
                check=False,
            )
            window_mode_res = await self.client.run(
                f"{quoted_remote_binary} show-window-options -t {target_window} -v window-size",
                check=False,
            )
            clients_res = await self.client.run(
                f'{quoted_remote_binary} list-clients -t {quoted_fingerprint} -F "#{{client_tty}} client=#{{client_height}}x#{{client_width}}"',
                check=False,
            )
            logger.info(
                "tmux-metrics phase=%s session_id=%s fingerprint=%s expected=%sx%s pane='%s' window_mode='%s' clients='%s' exits(pane=%s,window=%s,clients=%s)",
                phase,
                self.session_id,
                self.enhanced_fingerprint,
                expected_rows,
                expected_cols,
                (pane_res.stdout or "").strip(),
                (window_mode_res.stdout or "").strip(),
                (clients_res.stdout or "").strip().replace("\n", " | "),
                pane_res.exit_status,
                window_mode_res.exit_status,
                clients_res.exit_status,
            )
        except Exception as error:
            logger.warning(
                "tmux-metrics-failed phase=%s session_id=%s fingerprint=%s error=%s",
                phase,
                self.session_id,
                self.enhanced_fingerprint,
                error,
            )

    async def resize(self, rows: int, cols: int) -> None:
        if not self.channel:
            return
        self.resize_seq += 1
        seq = self.resize_seq
        pty_resize_ok = False
        logger.info(
            "resize-recv session_id=%s seq=%s rows=%s cols=%s enhanced=%s",
            self.session_id,
            seq,
            rows,
            cols,
            self.enhanced_enabled,
        )
        try:
            self.channel.change_terminal_size(cols, rows)
            pty_resize_ok = True
            logger.info(
                "resize-pty-ok session_id=%s seq=%s rows=%s cols=%s",
                self.session_id,
                seq,
                rows,
                cols,
            )
        except Exception as error:
            logger.warning(
                "resize-pty-failed session_id=%s seq=%s rows=%s cols=%s error=%s",
                self.session_id,
                seq,
                rows,
                cols,
                error,
            )
        if self.enhanced_enabled and self.enhanced_fingerprint and self.tmux_binary_path:
            quoted_remote_binary = shlex.quote(self.tmux_binary_path)
            quoted_fingerprint = shlex.quote(self.enhanced_fingerprint)
            target_window = shlex.quote(f"{self.enhanced_fingerprint}:0")
            target_pane = shlex.quote(f"{self.enhanced_fingerprint}:0.0")
            try:
                res_mode = await self.client.run(
                    f"{quoted_remote_binary} set-window-option -t {target_window} window-size manual",
                    check=False,
                )
                res_window = await self.client.run(
                    f"{quoted_remote_binary} resize-window -t {target_window} -x {cols} -y {rows}",
                    check=False,
                )
                res_pane = await self.client.run(
                    f"{quoted_remote_binary} resize-pane -t {target_pane} -x {cols} -y {rows}",
                    check=False,
                )
                clients = await self.client.run(
                    f"{quoted_remote_binary} list-clients -t {quoted_fingerprint} -F '#{{client_tty}}\t#{{client_control_mode}}'",
                    check=False,
                )
                refreshed = 0
                control_clients = 0
                client_count = 0
                if clients.exit_status == 0:
                    for line in (clients.stdout or "").splitlines():
                        raw_tty, _, raw_control_mode = line.partition("\t")
                        tty = raw_tty.strip()
                        if not tty:
                            continue
                        client_count += 1
                        control_mode = raw_control_mode.strip().lower()
                        if control_mode not in {"1", "on", "yes", "true"}:
                            continue
                        control_clients += 1
                        refresh_res = await self.client.run(
                            f"{quoted_remote_binary} refresh-client -t {shlex.quote(tty)} -C {cols}x{rows}",
                            check=False,
                        )
                        if refresh_res.exit_status == 0:
                            refreshed += 1
                logger.info(
                    "resize-tmux-ok session_id=%s seq=%s rows=%s cols=%s pty_resize_ok=%s exits(mode=%s,window=%s,pane=%s,clients=%s) clients(total=%s,control=%s,refreshed=%s)",
                    self.session_id,
                    seq,
                    rows,
                    cols,
                    pty_resize_ok,
                    res_mode.exit_status,
                    res_window.exit_status,
                    res_pane.exit_status,
                    clients.exit_status,
                    client_count,
                    control_clients,
                    refreshed,
                )
            except Exception as error:
                logger.warning(
                    "resize-tmux-fallback-skipped session_id=%s seq=%s rows=%s cols=%s error=%s",
                    self.session_id,
                    seq,
                    rows,
                    cols,
                    error,
                )
            await self._collect_tmux_metrics(f"resize_seq_{seq}", rows, cols)
        self.last_activity = utc_now()

    async def close(self) -> None:
        await close_ssh_resources(self.client, self.channel)
