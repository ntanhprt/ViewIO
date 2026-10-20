// ViewIO: sửa trực tiếp file văn bản (Markdown, text, code, CSV, HTML, draw.io dạng XML...).
// Lưu qua /docview/fs/save kèm ETag lúc mở: người khác sửa trước thì báo xung đột thay vì ghi đè âm thầm.
// Bucket bật versioning thì mỗi lần lưu giữ lại bản cũ.

import React, { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { info, saveText } from "../../ListObjects/fileOps";
import { Loading, Problem } from "./ViewerShell";
import CodeMirrorArea from "./CodeMirrorArea";

export const EDIT_LIMIT = 5 * 1024 * 1024;

interface IProps {
  bucket: string;
  objectKey: string;
  fileName: string;
  textPath: string; // URL tải nội dung (preview=true)
  markdown: boolean;
  onClose: (saved: boolean) => void;
}

const TextEditor = ({ bucket, objectKey, fileName, textPath, markdown, onClose }: IProps) => {
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [etag, setEtag] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [preview, setPreview] = useState(markdown);
  const [savedOnce, setSavedOnce] = useState(false);

  // etag lấy TRƯỚC khi đọc nội dung: nếu file đổi giữa chừng thì lúc lưu sẽ báo xung đột (phía an toàn)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await info(bucket, objectKey);
        if (st.size > EDIT_LIMIT) {
          throw new Error("File lớn hơn 5 MB, hãy tải về để sửa.");
        }
        const res = await fetch(textPath, { credentials: "same-origin" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const t = await res.text();
        if (alive) {
          setEtag(st.etag || "");
          setOrig(t);
          setText(t);
        }
      } catch (e: any) {
        alive && setError(e?.message || String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [bucket, objectKey, textPath]);

  const dirty = text !== null && text !== orig;

  const save = useCallback(
    async (force = false) => {
      if (text === null || saving) {
        return;
      }
      setSaving(true);
      setMsg("");
      try {
        let tag = etag;
        if (force) {
          tag = (await info(bucket, objectKey)).etag || "";
        }
        const r = await saveText(bucket, objectKey, tag, text);
        setEtag(r.etag);
        setOrig(text);
        setSavedOnce(true);
        setMsg("Đã lưu " + new Date().toLocaleTimeString());
      } catch (e: any) {
        if (e?.conflict && window.confirm("File đã được người khác sửa sau khi bạn mở.\nGhi đè bằng bản của bạn? (bản của họ vẫn còn trong lịch sử phiên bản nếu bucket bật versioning)")) {
          setSaving(false);
          await save(true);
          return;
        }
        setMsg("Không lưu được: " + (e?.message || e));
      } finally {
        setSaving(false);
      }
    },
    [bucket, objectKey, etag, saving, text],
  );

  const close = useCallback(() => {
    if (dirty && !window.confirm("Còn thay đổi chưa lưu. Đóng và bỏ thay đổi?")) {
      return;
    }
    onClose(savedOnce);
  }, [dirty, onClose, savedOnce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);

  if (error) {
    return <Problem title="Không mở được để sửa" message={error} onDownload={() => onClose(false)} />;
  }
  if (text === null) {
    return <Loading text="Đang mở để sửa..." />;
  }
  return (
    <div className="dv-edit">
      <div className="dv-edit-bar">
        <b className="dv-edit-name">
          {fileName}
          {dirty ? " •" : ""}
        </b>
        <span className="dv-edit-msg">{msg}</span>
        {markdown ? (
          <button type="button" className="dv-edit-btn" onClick={() => setPreview(!preview)}>
            {preview ? "Ẩn xem trước" : "Xem trước"}
          </button>
        ) : null}
        <button type="button" className="dv-edit-btn" onClick={() => setWrap(!wrap)}>
          {wrap ? "Không xuống dòng" : "Xuống dòng"}
        </button>
        <button type="button" className="dv-edit-btn dv-edit-primary" disabled={!dirty || saving} onClick={() => save()}>
          {saving ? "Đang lưu…" : "Lưu (Ctrl+S)"}
        </button>
        <button type="button" className="dv-edit-btn" onClick={close}>
          Đóng
        </button>
      </div>
      <div className="dv-edit-body">
        <CodeMirrorArea value={text} fileName={fileName} wrap={wrap} onChange={setText} />
        {markdown && preview ? (
          <div className="dv-edit-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TextEditor;
