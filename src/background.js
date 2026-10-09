// 取得済みの対局数を、ツールバーのアイコンに数字で出す。
// 取得が進むと数字が増えるので、ポップアップを開かなくても進み具合が分かる。
async function refreshBadge() {
  const all = await chrome.storage.local.get(null);
  const count = Object.keys(all).filter((key) => key.startsWith("game:")).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#1f5e4a" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}

chrome.storage.onChanged.addListener(refreshBadge);
chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

// CSVの保存。保存先とファイル名を選ぶ画面を、ブラウザに出させる。
// ポップアップは保存先を選ぶ画面が開くと閉じてしまうことがあるので、保存そのものはここ(裏で動く側)で行う。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "mps-save-csv") return false;
  // 先頭のBOMは、Excelが文字コードを取り違えないようにするためのもの。
  const url = "data:text/csv;charset=utf-8," + encodeURIComponent("\ufeff" + message.text);
  chrome.downloads
    .download({ url, filename: message.filename, saveAs: true })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      const text = String((error && error.message) || error);
      sendResponse({ ok: false, canceled: /cancel/i.test(text), message: text });
    });
  return true; // 保存先が決まるまで返事を待たせる
});
