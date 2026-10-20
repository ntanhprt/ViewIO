// ViewIO: nhiều người dùng chung một tài khoản nên mỗi người tự đặt "tên hiển thị" (lưu trên trình duyệt của họ).
// Tên được gửi kèm mọi yêu cầu cùng origin (header X-Viewio-User) để ghi vào nhật ký hoạt động / "người sửa cuối".

const KEY = "viewio.who";

export const getWho = (): string => {
  try {
    return (localStorage.getItem(KEY) || "").trim();
  } catch {
    return "";
  }
};

export const setWho = (name: string) => {
  try {
    localStorage.setItem(KEY, name.trim().slice(0, 60));
  } catch {
    // bỏ qua
  }
  window.dispatchEvent(new Event("viewio-who"));
};

let installed = false;
// Gắn header tên người vào fetch và XMLHttpRequest cùng origin (bao gồm upload/xoá của Console gốc)
export const installIdentityHeader = () => {
  if (installed) {
    return;
  }
  installed = true;
  const sameOrigin = (u: string) => {
    try {
      return new URL(u, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const who = getWho();
    if (who) {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (sameOrigin(u)) {
        const h = new Headers(init?.headers || (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined));
        if (!h.has("X-Viewio-User")) {
          h.set("X-Viewio-User", encodeURIComponent(who));
        }
        return origFetch(input, { ...(init || {}), headers: h });
      }
    }
    return origFetch(input, init);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    (origOpen as any).call(this, method, url, ...rest);
    const who = getWho();
    if (who && sameOrigin(String(url))) {
      try {
        this.setRequestHeader("X-Viewio-User", encodeURIComponent(who));
      } catch {
        // bỏ qua
      }
    }
  } as any;
};
