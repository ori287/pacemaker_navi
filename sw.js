/* Pacemaker Navi — Service Worker（オフライン対応）
   方針：通信できるときは常に最新を取りに行き（ネットワーク優先）、
         通信できない・応答が遅いときだけ端末に保存した前回分を返す。
         保存分を返したときは応答ヘッダ x-pn-cache: hit と取得日時 x-pn-fetched を付け、
         画面側で「保存データを表示中」と明示できるようにする。
   データ（JSON）の中身は一切加工しない。 */
var VERSION = "pn-2026-09-11-1";
var CACHE = "pn-cache-" + VERSION;
var TIMEOUT_MS = 4000;

/* 初回に保存しておくもの（classic.html は無くても失敗させない） */
var CORE = ["./", "index.html", "manifest.webmanifest", "icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
            "data.json", "algos.json", "products.json", "mri.json"];
var OPTIONAL = ["classic.html"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.concat(OPTIONAL).map(function (u) {
      return fetch(u, { cache: "no-cache" }).then(function (r) { if (r.ok) return stamp(r).then(function (s) { return c.put(keyOf(u), s); }); }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("pn-cache-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* ?t=… などのクエリを除いた URL を保存キーにする（従来の画面は data.json?t=時刻 で取りに来るため） */
function keyOf(u) { var url = new URL(u, self.registration.scope); url.search = ""; url.hash = ""; if (url.pathname.endsWith("/")) url.pathname += "index.html"; return url.href; }

/* 保存時に取得日時を付ける（本文はそのまま） */
function stamp(res) {
  var h = new Headers(res.headers); h.set("x-pn-fetched", new Date().toISOString());
  return res.clone().blob().then(function (b) { return new Response(b, { status: res.status, statusText: res.statusText, headers: h }); });
}
function markHit(res) {
  var h = new Headers(res.headers); h.set("x-pn-cache", "hit");
  return res.blob().then(function (b) { return new Response(b, { status: res.status, statusText: res.statusText, headers: h }); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              /* 外部への通信（共有機能など）には触らない */
  if (!url.href.startsWith(self.registration.scope)) return;
  e.respondWith(networkFirst(req));
});

function networkFirst(req) {
  var key = keyOf(req.url);
  return caches.open(CACHE).then(function (c) {
    var net = fetch(req, { cache: "no-cache" }).then(function (r) {
      if (r && r.ok && r.type === "basic") { stamp(r).then(function (s) { return c.put(key, s); }).catch(function () {}); }
      return r;
    });
    var timer = new Promise(function (resolve) { setTimeout(function () { resolve("timeout"); }, TIMEOUT_MS); });
    return Promise.race([net.catch(function () { return "error"; }), timer]).then(function (first) {
      if (first !== "timeout" && first !== "error") return first;
      return c.match(key).then(function (hit) {
        if (hit) return markHit(hit);
        return net;                                             /* 保存分が無ければ通信の結果を待つ */
      });
    });
  });
}
