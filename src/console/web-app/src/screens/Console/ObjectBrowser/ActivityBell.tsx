// ViewIO: chuông "Thông báo" — ai vừa làm gì với file nào (mới nhất ở trên), dành cho nhóm dùng chung một tài khoản.
// Nguồn: nhật ký hoạt động của máy chủ (/docview/fs/activity). Có đếm chưa đọc, báo nhanh khi người khác vừa thay đổi,
// và ô đặt "tên của bạn" (gửi kèm mọi thao tác để biết ai làm).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch } from "../../../store";
import { setSnackBarMessage } from "../../../systemSlice";
import {
  setPreviewOpen,
  setSelectedPreview,
} from "./objectBrowserSlice";
import {
  ActivityEntry,
  baseName,
  fsParent,
  getActivity,
  info,
} from "../Buckets/ListBuckets/Objects/ListObjects/fileOps";
import { getWho, setWho } from "../../../identity";
import "./ActivityBell.css";

const VERB: Record<string, string> = {
  upload: "đã tải lên",
  edit: "đã sửa",
  delete: "đã xoá",
  move: "đã chuyển",
  copy: "đã sao chép",
  trash: "đã chuyển vào thùng rác",
  restore: "đã khôi phục",
  rename: "đã đổi tên",
  mkdir: "đã tạo thư mục",
  create: "đã tạo",
  purge: "đã xoá vĩnh viễn",
};

const ICON: Record<string, string> = {
  upload: "⬆",
  edit: "✎",
  delete: "🗑",
  move: "➜",
  copy: "⧉",
  trash: "🗑",
  restore: "↩",
  rename: "✎",
  mkdir: "📁",
  create: "＋",
  purge: "✕",
};

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) {
    return "vừa xong";
  }
  if (s < 3600) {
    return `${Math.round(s / 60)} phút trước`;
  }
  if (s < 86400) {
    return `${Math.round(s / 3600)} giờ trước`;
  }
  return new Date(t).toLocaleString();
};

const SEEN = "viewio.actSeen";
const ASKED = "viewio.whoAsked";
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) || "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // bỏ qua
    }
  },
};

const ActivityBell = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [seen, setSeen] = useState<number>(Number(ls.get(SEEN)) || 0);
  const [who, setWhoState] = useState(getWho());
  const [nameDraft, setNameDraft] = useState(getWho());
  const [onlyOthers, setOnlyOthers] = useState(false);
  const [asking, setAsking] = useState(false);
  const lastNow = useRef<number>(0);
  const wrap = useRef<HTMLDivElement | null>(null);

  // lần đầu vào: hỏi tên (bỏ qua được)
  useEffect(() => {
    if (!getWho() && !ls.get(ASKED)) {
      setAsking(true);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const d = await getActivity();
      const me = getWho();
      if (lastNow.current) {
        const fresh = d.entries.filter(
          (e) => e.t > lastNow.current && (!me || e.actor !== me),
        );
        if (fresh.length === 1) {
          const e = fresh[0];
          dispatch(setSnackBarMessage(`${e.actor} ${VERB[e.op] || e.op} ${baseName(e.key)}`));
        } else if (fresh.length > 1) {
          dispatch(setSnackBarMessage(`${fresh.length} thay đổi mới từ người khác`));
        }
      }
      lastNow.current = d.now;
      setEntries(d.entries);
    } catch {
      // mất mạng / chưa đăng nhập: thử lại lần sau
    }
  }, [dispatch]);

  useEffect(() => {
    poll();
    const id = setInterval(() => {
      if (!document.hidden) {
        poll();
      }
    }, 20000);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    if (!open) {
      return;
    }
    poll();
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, poll]);

  const me = who;
  const unread = entries.filter((e) => e.t > seen && (!me || e.actor !== me)).length;
  const shown = onlyOthers && me ? entries.filter((e) => e.actor !== me) : entries;

  const markRead = () => {
    const t = entries.length ? entries[0].t : Date.now();
    ls.set(SEEN, String(t));
    setSeen(t);
  };

  const saveName = (n: string) => {
    setWho(n);
    setWhoState(n.trim());
    ls.set(ASKED, "1");
    setAsking(false);
  };

  const openEntry = async (e: ActivityEntry) => {
    setOpen(false);
    const target = e.op === "move" || e.op === "rename" || e.op === "copy" || e.op === "restore" ? e.to || e.key : e.key;
    const isDir = target.endsWith("/");
    const folder = isDir ? target : fsParent(target);
    navigate(`/browser/${encodeURIComponent(e.bucket)}${folder ? `/${encodeURIComponent(folder)}` : ""}`);
    if (!isDir && e.op !== "delete" && e.op !== "trash" && e.op !== "purge") {
      try {
        const st = await info(e.bucket, target);
        setTimeout(() => {
          dispatch(
            setSelectedPreview({
              name: target,
              size: st.size,
              last_modified: st.modified || "",
              version_id: "",
              content_type: st.contentType,
            } as any),
          );
          dispatch(setPreviewOpen(true));
        }, 700);
      } catch {
        // file không còn: chỉ mở thư mục
      }
    }
  };

  return (
    <div className="vio-bell-wrap" ref={wrap}>
      <button
        type="button"
        className="vio-bell"
        title="Thông báo: ai vừa sửa gì"
        aria-label="Thông báo"
        onClick={() => setOpen(!open)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? <span className="vio-bell-badge">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="vio-bell-panel">
          <div className="vio-bell-head">
            <b>Thông báo</b>
            <label className="vio-bell-chk">
              <input type="checkbox" checked={onlyOthers} onChange={(e) => setOnlyOthers(e.target.checked)} /> Chỉ của người khác
            </label>
            <button type="button" className="vio-bell-link" onClick={markRead} disabled={unread === 0}>
              Đánh dấu đã đọc
            </button>
          </div>
          <div className="vio-bell-who">
            Tên của bạn:
            <input
              className="vio-bell-input"
              value={nameDraft}
              placeholder="vd: Minh"
              maxLength={60}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName(nameDraft)}
            />
            <button type="button" className="vio-bell-link" disabled={nameDraft.trim() === who} onClick={() => saveName(nameDraft)}>
              Lưu
            </button>
          </div>
          <div className="vio-bell-list">
            {shown.length === 0 ? <div className="vio-bell-empty">Chưa có hoạt động nào</div> : null}
            {shown.map((e, i) => (
              <button type="button" key={`${e.t}-${i}`} className={`vio-bell-item ${e.t > seen && (!me || e.actor !== me) ? "vio-new" : ""}`} onClick={() => openEntry(e)}>
                <span className="vio-bell-ic">{ICON[e.op] || "•"}</span>
                <span className="vio-bell-txt">
                  <span>
                    <b>{e.actor}{me && e.actor === me ? " (bạn)" : ""}</b> {VERB[e.op] || e.op} <b>{baseName(e.key) || e.key}</b>
                    {(e.op === "move" || e.op === "rename" || e.op === "copy") && e.to ? <> → <b>{baseName(e.to)}</b></> : null}
                  </span>
                  <span className="vio-bell-sub">
                    {e.bucket}/{fsParent(e.key)} · {ago(e.t)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {asking ? (
        <div className="vio-overlay" onMouseDown={() => saveName("")}>
          <div className="vio-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Bạn tên là gì?</h3>
            <div className="vio-muted" style={{ paddingLeft: 0 }}>
              Nhiều người dùng chung một tài khoản. Cho biết tên để mọi người thấy ai vừa sửa/tải lên file nào (tên chỉ lưu trên trình duyệt này, đổi được ở chuông Thông báo).
            </div>
            <input
              className="vio-input"
              autoFocus
              placeholder="vd: Minh"
              maxLength={60}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && nameDraft.trim() && saveName(nameDraft)}
            />
            <div className="vio-actions">
              <button type="button" className="vio-btn" onClick={() => saveName("")}>
                Bỏ qua
              </button>
              <button type="button" className="vio-btn vio-primary" disabled={!nameDraft.trim()} onClick={() => saveName(nameDraft)}>
                Lưu
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ActivityBell;
