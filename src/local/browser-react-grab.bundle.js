(() => {
  /**
   * @license MIT
   *
   * Copyright (c) 2025 Aiden Bai
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */ var w = null,
    ct = () => {
      if (w !== null) return w;
      try {
        w = window.matchMedia("(color-gamut: p3)").matches;
      } catch {
        w = !1;
      }
      return w;
    },
    ft = ct(),
    b = (e) => (ft ? `color(display-p3 0.84 0.19 0.78 / ${e})` : `rgba(210, 57, 192, ${e})`);
  var we = 1e4;
  var Yr = b(0.4),
    Qr = b(0.05),
    en = b(0.5),
    tn = b(0.08),
    rn = b(0.3),
    nn = b(0.04),
    on = b(0.15);
  var Q = "data-react-grab-frozen";
  var ln = 2 * 1024 * 1024;
  var I = new Set(
      "display.position.top.right.bottom.left.z-index.overflow.overflow-x.overflow-y.width.height.min-width.min-height.max-width.max-height.margin-top.margin-right.margin-bottom.margin-left.padding-top.padding-right.padding-bottom.padding-left.flex-direction.flex-wrap.justify-content.align-items.align-self.align-content.flex-grow.flex-shrink.flex-basis.order.gap.row-gap.column-gap.grid-template-columns.grid-template-rows.grid-template-areas.font-family.font-size.font-weight.font-style.line-height.letter-spacing.text-align.text-decoration-line.text-decoration-style.text-transform.text-overflow.text-shadow.white-space.word-break.overflow-wrap.vertical-align.color.background-color.background-image.background-position.background-size.background-repeat.border-top-width.border-right-width.border-bottom-width.border-left-width.border-top-style.border-right-style.border-bottom-style.border-left-style.border-top-color.border-right-color.border-bottom-color.border-left-color.border-top-left-radius.border-top-right-radius.border-bottom-left-radius.border-bottom-right-radius.box-shadow.opacity.transform.filter.backdrop-filter.object-fit.object-position".split(
        ".",
      ),
    ),
    ee = (e) => (e.tagName || "").toLowerCase();
  var Se = typeof window < "u",
    mt = (e) => 0,
    dt = (e) => {},
    te = Se
      ? (
          Object.getOwnPropertyDescriptor(Window.prototype, "requestAnimationFrame")?.value ??
          window.requestAnimationFrame
        ).bind(window)
      : mt,
    re = Se
      ? (
          Object.getOwnPropertyDescriptor(Window.prototype, "cancelAnimationFrame")?.value ??
          window.cancelAnimationFrame
        ).bind(window)
      : dt;
  var ve = "bippy-0.5.39",
    ne = Object.defineProperty,
    pt = Object.prototype.hasOwnProperty,
    _ = () => {},
    Ne = (e) => {
      try {
        Function.prototype.toString.call(e).indexOf("^_^") > -1 &&
          setTimeout(() => {
            throw Error(
              "React is running in production mode, but dead code elimination has not been applied. Read how to correctly configure React for production: https://reactjs.org/link/perf-use-production-build",
            );
          });
      } catch {}
    },
    _e = (e = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) => !!(e && "getFiberRoots" in e),
    Ee = !1,
    oe,
    z = (e = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) =>
      Ee
        ? !0
        : (e && typeof e.inject == "function" && (oe = e.inject.toString()),
          !!oe?.includes("(injected)")),
    R = new Set(),
    E = new Set(),
    ht = (e) => {
      let t = new Map(),
        r = 0,
        n = {
          _instrumentationIsActive: !1,
          _instrumentationSource: ve,
          checkDCE: Ne,
          hasUnsupportedRendererAttached: !1,
          inject(i) {
            let o = ++r;
            return (
              t.set(o, i),
              E.add(i),
              n._instrumentationIsActive ||
                ((n._instrumentationIsActive = !0), R.forEach((l) => l())),
              o
            );
          },
          on: _,
          onCommitFiberRoot: _,
          onCommitFiberUnmount: _,
          onPostCommitFiberRoot: _,
          renderers: t,
          supportsFiber: !0,
          supportsFlight: !0,
        };
      try {
        ne(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
          configurable: !0,
          enumerable: !0,
          get() {
            return n;
          },
          set(l) {
            if (l && typeof l == "object") {
              let a = n.renderers;
              ((n = l),
                a.size > 0 &&
                  (a.forEach((f, m) => {
                    (E.add(f), l.renderers.set(m, f));
                  }),
                  M(e)));
            }
          },
        });
        let i = window.hasOwnProperty,
          o = !1;
        ne(window, "hasOwnProperty", {
          configurable: !0,
          value: function (...l) {
            try {
              if (!o && l[0] === "__REACT_DEVTOOLS_GLOBAL_HOOK__")
                return ((globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = void 0), (o = !0), -0);
            } catch {}
            return i.apply(this, l);
          },
          writable: !0,
        });
      } catch {
        M(e);
      }
      return n;
    },
    M = (e) => {
      e && R.add(e);
      try {
        let t = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (!t) return;
        if (!t._instrumentationSource) {
          ((t.checkDCE = Ne),
            (t.supportsFiber = !0),
            (t.supportsFlight = !0),
            (t.hasUnsupportedRendererAttached = !1),
            (t._instrumentationSource = ve),
            (t._instrumentationIsActive = !1));
          let r = _e(t);
          if ((r || (t.on = _), t.renderers.size)) {
            ((t._instrumentationIsActive = !0), R.forEach((o) => o()));
            return;
          }
          let n = t.inject,
            i = z(t);
          (i &&
            !r &&
            ((Ee = !0), t.inject({ scheduleRefresh() {} }) && (t._instrumentationIsActive = !0)),
            (t.inject = (o) => {
              let l = n(o);
              return (
                E.add(o),
                i && t.renderers.set(l, o),
                (t._instrumentationIsActive = !0),
                R.forEach((a) => a()),
                l
              );
            }));
        }
        (t.renderers.size || t._instrumentationIsActive || z()) && e?.();
      } catch {}
    },
    gt = () => pt.call(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__"),
    xe = (e) => (gt() ? (M(e), globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) : ht(e)),
    bt = () =>
      !!(
        typeof window < "u" &&
        (window.document?.createElement || window.navigator?.product === "ReactNative")
      ),
    yt = () => {
      try {
        bt() && xe();
      } catch {}
    },
    ke = (e) => {
      switch (e.tag) {
        case 1:
        case 11:
        case 0:
        case 14:
        case 15:
          return !0;
        default:
          return !1;
      }
    };
  function W(e, t, r = !1) {
    if (!e) return null;
    let n = t(e);
    if (n instanceof Promise)
      return (async () => {
        if ((await n) === !0) return e;
        let o = r ? e.return : e.child;
        for (; o;) {
          let l = await Oe(o, t, r);
          if (l) return l;
          o = r ? null : o.sibling;
        }
        return null;
      })();
    if (n === !0) return e;
    let i = r ? e.return : e.child;
    for (; i;) {
      let o = Ae(i, t, r);
      if (o) return o;
      i = r ? null : i.sibling;
    }
    return null;
  }
  var Ae = (e, t, r = !1) => {
      if (!e) return null;
      if (t(e) === !0) return e;
      let n = r ? e.return : e.child;
      for (; n;) {
        let i = Ae(n, t, r);
        if (i) return i;
        n = r ? null : n.sibling;
      }
      return null;
    },
    Oe = async (e, t, r = !1) => {
      if (!e) return null;
      if ((await t(e)) === !0) return e;
      let n = r ? e.return : e.child;
      for (; n;) {
        let i = await Oe(n, t, r);
        if (i) return i;
        n = r ? null : n.sibling;
      }
      return null;
    },
    $e = (e) => {
      let t = e;
      return typeof t == "function" ? t : typeof t == "object" && t ? $e(t.type || t.render) : null;
    },
    x = (e) => {
      let t = e;
      if (typeof t == "string") return t;
      if (typeof t != "function" && !(typeof t == "object" && t)) return null;
      let r = t.displayName || t.name || null;
      if (r) return r;
      let n = $e(t);
      return (n && (n.displayName || n.name)) || null;
    },
    j = () => {
      let e = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      return !!e?._instrumentationIsActive || _e(e) || z(e);
    };
  var y = (e) => {
    let t = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (t?.renderers)
      for (let r of t.renderers.values())
        try {
          let n = r.findFiberByHostInstance?.(e);
          if (n) return n;
        } catch {}
    if (typeof e == "object" && e) {
      if ("_reactRootContainer" in e) return e._reactRootContainer?._internalRoot?.current?.child;
      for (let r in e)
        if (
          r.startsWith("__reactContainer$") ||
          r.startsWith("__reactInternalInstance$") ||
          r.startsWith("__reactFiber")
        )
          return e[r] || null;
    }
    return null;
  };
  var ie = /^[a-zA-Z][a-zA-Z\d+\-.]*:/,
    wt = [
      "rsc://",
      "file:///",
      "webpack-internal://",
      "webpack://",
      "node:",
      "turbopack://",
      "metro://",
      "/app-pages-browser/",
      "/(app-pages-browser)/",
    ],
    St = ["<anonymous>", "eval", ""],
    Ce = /\.(jsx|tsx|ts|js)$/,
    vt =
      /(\.min|bundle|chunk|vendor|vendors|runtime|polyfill|polyfills)\.(js|mjs|cjs)$|(chunk|bundle|vendor|vendors|runtime|polyfill|polyfills|framework|app|main|index)[-_.][A-Za-z0-9_-]{4,}\.(js|mjs|cjs)$|[\da-f]{8,}\.(js|mjs|cjs)$|[-_.][\da-f]{20,}\.(js|mjs|cjs)$|\/dist\/|\/build\/|\/.next\/|\/out\/|\/node_modules\/|\.webpack\.|\.vite\.|\.turbopack\./i,
    Nt = /^\?[\w~.-]+(?:=[^&#]*)?(?:&[\w~.-]+(?:=[^&#]*)?)*$/,
    _t = /(^|@)\S+:\d+/,
    Re = /^\s*at .*(\S+:\d+|\(native\))/m,
    Et = /^(eval@)?(\[native code\])?$/,
    B = (e, t) => {
      if (t?.includeInElement !== !1) {
        let r = e.split(`
`),
          n = [];
        for (let i of r)
          if (/^\s*at\s+/.test(i)) {
            let o = le(i, void 0)[0];
            o && n.push(o);
          } else if (/^\s*in\s+/.test(i)) {
            let o = i.replace(/^\s*in\s+/, "").replace(/\s*\(at .*\)$/, "");
            n.push({ functionName: o, source: i });
          } else if (i.match(_t)) {
            let o = ae(i, void 0)[0];
            o && n.push(o);
          }
        return G(n, t);
      }
      return e.match(Re) ? le(e, t) : ae(e, t);
    },
    Te = (e) => {
      if (!e.includes(":")) return [e, void 0, void 0];
      let t = e.startsWith("(") && /:\d+\)$/.test(e) ? e.slice(1, -1) : e,
        r = /(.+?)(?::(\d+))?(?::(\d+))?$/.exec(t);
      return r ? [r[1], r[2] || void 0, r[3] || void 0] : [t, void 0, void 0];
    },
    G = (e, t) =>
      t && t.slice != null
        ? Array.isArray(t.slice)
          ? e.slice(t.slice[0], t.slice[1])
          : e.slice(0, t.slice)
        : e,
    le = (e, t) =>
      G(
        e
          .split(
            `
`,
          )
          .filter((r) => !!r.match(Re)),
        t,
      ).map((r) => {
        let n = r;
        n.includes("(eval ") &&
          (n = n.replace(/eval code/g, "eval").replace(/(\(eval at [^()]*)|(,.*$)/g, ""));
        let i = n
            .replace(/^\s+/, "")
            .replace(/\(eval code/g, "(")
            .replace(/^.*?\s+/, ""),
          o = i.match(/ (\(.+\)$)/);
        i = o ? i.replace(o[0], "") : i;
        let l = Te(o ? o[1] : i);
        return {
          functionName: (o && i) || void 0,
          fileName: ["eval", "<anonymous>"].includes(l[0]) ? void 0 : l[0],
          lineNumber: l[1] ? +l[1] : void 0,
          columnNumber: l[2] ? +l[2] : void 0,
          source: n,
        };
      }),
    ae = (e, t) =>
      G(
        e
          .split(
            `
`,
          )
          .filter((r) => !r.match(Et)),
        t,
      ).map((r) => {
        let n = r;
        if (
          (n.includes(" > eval") &&
            (n = n.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g, ":$1")),
          !n.includes("@") && !n.includes(":"))
        )
          return { functionName: n };
        {
          let i =
              /(([^\n\r"\u2028\u2029]*".[^\n\r"\u2028\u2029]*"[^\n\r@\u2028\u2029]*(?:@[^\n\r"\u2028\u2029]*"[^\n\r@\u2028\u2029]*)*(?:[\n\r\u2028\u2029][^@]*)?)?[^@]*)@/,
            o = n.match(i),
            l = o && o[1] ? o[1] : void 0,
            a = Te(n.replace(i, ""));
          return {
            functionName: l,
            fileName: a[0],
            lineNumber: a[1] ? +a[1] : void 0,
            columnNumber: a[2] ? +a[2] : void 0,
            source: n,
          };
        }
      }),
    xt = 44,
    se = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    kt = new Uint8Array(64),
    je = new Uint8Array(128);
  for (let e = 0; e < se.length; e++) {
    let t = se.charCodeAt(e);
    ((kt[e] = t), (je[t] = e));
  }
  function S(e, t) {
    let r = 0,
      n = 0,
      i = 0;
    do ((i = je[e.next()]), (r |= (i & 31) << n), (n += 5));
    while (i & 32);
    let o = r & 1;
    return ((r >>>= 1), o && (r = -2147483648 | -r), t + r);
  }
  function ue(e, t) {
    return e.pos >= t ? !1 : e.peek() !== xt;
  }
  var At = class {
    constructor(e) {
      ((this.pos = 0), (this.buffer = e));
    }
    next() {
      return this.buffer.charCodeAt(this.pos++);
    }
    peek() {
      return this.buffer.charCodeAt(this.pos);
    }
    indexOf(e) {
      let { buffer: t, pos: r } = this,
        n = t.indexOf(e, r);
      return n === -1 ? t.length : n;
    }
  };
  function Le(e) {
    let { length: t } = e,
      r = new At(e),
      n = [],
      i = 0,
      o = 0,
      l = 0,
      a = 0,
      f = 0;
    do {
      let m = r.indexOf(";"),
        u = [],
        c = !0,
        s = 0;
      for (i = 0; r.pos < m;) {
        let d;
        ((i = S(r, i)),
          i < s && (c = !1),
          (s = i),
          ue(r, m)
            ? ((o = S(r, o)),
              (l = S(r, l)),
              (a = S(r, a)),
              ue(r, m) ? ((f = S(r, f)), (d = [i, o, l, a, f])) : (d = [i, o, l, a]))
            : (d = [i]),
          u.push(d),
          r.pos++);
      }
      (c || Ot(u), n.push(u), (r.pos = m + 1));
    } while (r.pos <= t);
    return n;
  }
  function Ot(e) {
    e.sort($t);
  }
  function $t(e, t) {
    return e[0] - t[0];
  }
  var De = /^[a-zA-Z][a-zA-Z\d+\-.]*:/,
    Ct = /^data:application\/json[^,]+base64,/,
    Rt =
      /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^*]+?)[ \t]*(?:\*\/)[ \t]*$)/,
    Pe = typeof WeakRef < "u",
    v = new Map(),
    $ = new Map(),
    Tt = (e) => Pe && e instanceof WeakRef,
    ce = (e, t, r, n) => {
      if (r < 0 || r >= e.length) return null;
      let i = e[r];
      if (!i || i.length === 0) return null;
      let o = null;
      for (let u of i)
        if (u[0] <= n) o = u;
        else break;
      if (!o || o.length < 4) return null;
      let [, l, a, f] = o;
      if (l === void 0 || a === void 0 || f === void 0) return null;
      let m = t[l];
      return m ? { columnNumber: f, fileName: m, lineNumber: a + 1 } : null;
    },
    jt = (e, t, r) => {
      if (e.sections) {
        let n = null;
        for (let l of e.sections)
          if (t > l.offset.line || (t === l.offset.line && r >= l.offset.column)) n = l;
          else break;
        if (!n) return null;
        let i = t - n.offset.line,
          o = t === n.offset.line ? r - n.offset.column : r;
        return ce(n.map.mappings, n.map.sources, i, o);
      }
      return ce(e.mappings, e.sources, t - 1, r);
    },
    Lt = (e, t) => {
      let r = t.split(`
`),
        n;
      for (let o = r.length - 1; o >= 0 && !n; o--) {
        let l = r[o].match(Rt);
        l && (n = l[1] || l[2]);
      }
      if (!n) return null;
      let i = De.test(n);
      if (!(Ct.test(n) || i || n.startsWith("/"))) {
        let o = e.split("/");
        ((o[o.length - 1] = n), (n = o.join("/")));
      }
      return n;
    },
    Dt = (e) => ({
      file: e.file,
      mappings: Le(e.mappings),
      names: e.names,
      sourceRoot: e.sourceRoot,
      sources: e.sources,
      sourcesContent: e.sourcesContent,
      version: 3,
    }),
    Pt = (e) => {
      let t = e.sections.map(({ map: n, offset: i }) => ({
          map: { ...n, mappings: Le(n.mappings) },
          offset: i,
        })),
        r = new Set();
      for (let n of t) for (let i of n.map.sources) r.add(i);
      return {
        file: e.file,
        mappings: [],
        names: [],
        sections: t,
        sourceRoot: void 0,
        sources: Array.from(r),
        sourcesContent: void 0,
        version: 3,
      };
    },
    fe = (e) => {
      if (!e) return !1;
      let t = e.trim();
      if (!t) return !1;
      let r = t.match(De);
      if (!r) return !0;
      let n = r[0].toLowerCase();
      return n === "http:" || n === "https:";
    },
    Vt = async (e, t = fetch) => {
      if (!fe(e)) return null;
      let r;
      try {
        let i = await t(e);
        if (!i.ok) return null;
        r = await i.text();
      } catch {
        return null;
      }
      if (!r) return null;
      let n = Lt(e, r);
      if (!n || !fe(n)) return null;
      try {
        let i = await t(n);
        if (!i.ok) return null;
        let o = await i.json();
        return "sections" in o ? Pt(o) : Dt(o);
      } catch {
        return null;
      }
    },
    zt = async (e, t = !0, r) => {
      if (t && v.has(e)) {
        let o = v.get(e);
        if (o == null) return null;
        if (Tt(o)) {
          let l = o.deref();
          if (l) return l;
          v.delete(e);
        } else return o;
      }
      if (t && $.has(e)) return $.get(e);
      let n = Vt(e, r);
      t && $.set(e, n);
      let i = await n;
      return (
        t && $.delete(e),
        t && (i === null ? v.set(e, null) : v.set(e, Pe ? new WeakRef(i) : i)),
        i
      );
    },
    Mt = async (e, t = !0, r) =>
      await Promise.all(
        e.map(async (n) => {
          if (!n.fileName) return n;
          let i = await zt(n.fileName, t, r);
          if (!i || typeof n.lineNumber != "number" || typeof n.columnNumber != "number") return n;
          let o = jt(i, n.lineNumber, n.columnNumber);
          return o
            ? {
                ...n,
                source:
                  o.fileName && n.source ? n.source.replace(n.fileName, o.fileName) : n.source,
                fileName: o.fileName,
                lineNumber: o.lineNumber,
                columnNumber: o.columnNumber,
                isSymbolicated: !0,
              }
            : n;
        }),
      ),
    Ve = (e) => e._debugStack instanceof Error && typeof e._debugStack?.stack == "string",
    Ft = () => {
      let e = xe();
      for (let t of [...Array.from(E), ...Array.from(e.renderers.values())]) {
        let r = t.currentDispatcherRef;
        if (r && typeof r == "object") return "H" in r ? r.H : r.current;
      }
      return null;
    },
    me = (e) => {
      for (let t of E) {
        let r = t.currentDispatcherRef;
        r && typeof r == "object" && ("H" in r ? (r.H = e) : (r.current = e));
      }
    },
    g = (e) => `
    in ${e}`,
    Ht = (e, t) => {
      let r = g(e);
      return (t && (r += ` (at ${t})`), r);
    },
    L = !1,
    D = (e, t) => {
      if (!e || L) return "";
      let r = Error.prepareStackTrace;
      ((Error.prepareStackTrace = void 0), (L = !0));
      let n = Ft();
      me(null);
      let i = console.error,
        o = console.warn;
      ((console.error = () => {}), (console.warn = () => {}));
      try {
        let a = {
          DetermineComponentFrameRoot() {
            let u;
            try {
              if (t) {
                let c = function () {
                  throw Error();
                };
                if (
                  (Object.defineProperty(c.prototype, "props", {
                    set: function () {
                      throw Error();
                    },
                  }),
                  typeof Reflect == "object" && Reflect.construct)
                ) {
                  try {
                    Reflect.construct(c, []);
                  } catch (s) {
                    u = s;
                  }
                  Reflect.construct(e, [], c);
                } else {
                  try {
                    c.call();
                  } catch (s) {
                    u = s;
                  }
                  e.call(c.prototype);
                }
              } else {
                try {
                  throw Error();
                } catch (s) {
                  u = s;
                }
                let c = e();
                c && typeof c.catch == "function" && c.catch(() => {});
              }
            } catch (c) {
              if (c instanceof Error && u instanceof Error && typeof c.stack == "string")
                return [c.stack, u.stack];
            }
            return [null, null];
          },
        };
        ((a.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot"),
          Object.getOwnPropertyDescriptor(a.DetermineComponentFrameRoot, "name")?.configurable &&
            Object.defineProperty(a.DetermineComponentFrameRoot, "name", {
              value: "DetermineComponentFrameRoot",
            }));
        let [f, m] = a.DetermineComponentFrameRoot();
        if (f && m) {
          let u = f.split(`
`),
            c = m.split(`
`),
            s = 0,
            d = 0;
          for (; s < u.length && !u[s].includes("DetermineComponentFrameRoot");) s++;
          for (; d < c.length && !c[d].includes("DetermineComponentFrameRoot");) d++;
          if (s === u.length || d === c.length)
            for (s = u.length - 1, d = c.length - 1; s >= 1 && d >= 0 && u[s] !== c[d];) d--;
          for (; s >= 1 && d >= 0; s--, d--)
            if (u[s] !== c[d]) {
              if (s !== 1 || d !== 1)
                do
                  if ((s--, d--, d < 0 || u[s] !== c[d])) {
                    let O = `
${u[s].replace(" at new ", " at ")}`,
                      Y = x(e);
                    return (Y && O.includes("<anonymous>") && (O = O.replace("<anonymous>", Y)), O);
                  }
                while (s >= 1 && d >= 0);
              break;
            }
        }
      } finally {
        ((L = !1), (Error.prepareStackTrace = r), me(n), (console.error = i), (console.warn = o));
      }
      let l = e ? x(e) : "";
      return l ? g(l) : "";
    },
    It = (e, t) => {
      let r = e.tag,
        n = "";
      switch (r) {
        case 28:
          n = g("Activity");
          break;
        case 1:
          n = D(e.type, !0);
          break;
        case 11:
          n = D(e.type.render, !1);
          break;
        case 0:
        case 15:
          n = D(e.type, !1);
          break;
        case 5:
        case 26:
        case 27:
          n = g(e.type);
          break;
        case 16:
          n = g("Lazy");
          break;
        case 13:
          n = e.child !== t && t !== null ? g("Suspense Fallback") : g("Suspense");
          break;
        case 19:
          n = g("SuspenseList");
          break;
        case 30:
          n = g("ViewTransition");
          break;
        default:
          return "";
      }
      return n;
    },
    Wt = (e) => {
      try {
        let t = "",
          r = e,
          n = null;
        do {
          t += It(r, n);
          let i = r._debugInfo;
          if (i && Array.isArray(i))
            for (let o = i.length - 1; o >= 0; o--) {
              let l = i[o];
              typeof l.name == "string" && (t += Ht(l.name, l.env));
            }
          ((n = r), (r = r.return));
        } while (r);
        return t;
      } catch (t) {
        return t instanceof Error
          ? `
Error generating stack: ${t.message}
${t.stack}`
          : "";
      }
    },
    ze = (e) => {
      let t = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      let r = e;
      if (!r) return "";
      ((Error.prepareStackTrace = t),
        r.startsWith(`Error: react-stack-top-frame
`) && (r = r.slice(29)));
      let n = r.indexOf(`
`);
      if (
        (n !== -1 && (r = r.slice(n + 1)),
        (n = Math.max(
          r.indexOf("react_stack_bottom_frame"),
          r.indexOf("react-stack-bottom-frame"),
        )),
        n !== -1 &&
          (n = r.lastIndexOf(
            `
`,
            n,
          )),
        n !== -1)
      )
        r = r.slice(0, n);
      else return "";
      return r;
    },
    Bt = (e) => !!(e.fileName?.startsWith("rsc://") && e.functionName),
    Gt = (e, t) =>
      e.fileName === t.fileName &&
      e.lineNumber === t.lineNumber &&
      e.columnNumber === t.columnNumber,
    Ut = (e) => {
      let t = new Map();
      for (let r of e)
        for (let n of r.stackFrames) {
          if (!Bt(n)) continue;
          let i = n.functionName,
            o = t.get(i) ?? [];
          o.some((l) => Gt(l, n)) || (o.push(n), t.set(i, o));
        }
      return t;
    },
    qt = (e, t, r) => {
      if (!e.functionName) return { ...e, isServer: !0 };
      let n = t.get(e.functionName);
      if (!n || n.length === 0) return { ...e, isServer: !0 };
      let i = r.get(e.functionName) ?? 0,
        o = n[i % n.length];
      return (
        r.set(e.functionName, i + 1),
        {
          ...e,
          isServer: !0,
          fileName: o.fileName,
          lineNumber: o.lineNumber,
          columnNumber: o.columnNumber,
          source: e.source?.replace(
            "(at Server)",
            `(${o.fileName}:${o.lineNumber}:${o.columnNumber})`,
          ),
        }
      );
    },
    Kt = (e) => {
      let t = [];
      return (
        W(
          e,
          (r) => {
            if (!Ve(r)) return;
            let n = typeof r.type == "string" ? r.type : x(r.type) || "<anonymous>";
            t.push({ componentName: n, stackFrames: B(ze(r._debugStack?.stack)) });
          },
          !0,
        ),
        t
      );
    },
    Zt = async (e, t = !0, r) => {
      let n = Kt(e),
        i = B(Wt(e)),
        o = Ut(n),
        l = new Map();
      return Mt(
        i
          .map((a) => ((a.source?.includes("(at Server)") ?? !1) ? qt(a, o, l) : a))
          .filter((a, f, m) => {
            if (f === 0) return !0;
            let u = m[f - 1];
            return a.functionName !== u.functionName;
          }),
        t,
        r,
      );
    },
    de = (e) => e.split("/").filter(Boolean).length,
    Xt = (e) => e.split("/").filter(Boolean)[0] ?? null,
    Jt = (e) => {
      let t = e.indexOf("/", 1);
      if (t === -1 || de(e.slice(0, t)) !== 1) return e;
      let r = e.slice(t);
      if (!Ce.test(r) || de(r) < 2) return e;
      let n = Xt(r);
      return !n || n.startsWith("@") || n.length > 4 ? e : r;
    },
    Me = (e) => {
      if (!e || St.some((o) => o === e)) return "";
      let t = e,
        r = t.startsWith("http://") || t.startsWith("https://");
      if (r)
        try {
          t = new URL(t).pathname;
        } catch {}
      if ((r && (t = Jt(t)), t.startsWith("about://React/"))) {
        let o = t.slice(14),
          l = o.indexOf("/"),
          a = o.indexOf(":");
        t = l !== -1 && (a === -1 || l < a) ? o.slice(l + 1) : o;
      }
      let n = !0;
      for (; n;) {
        n = !1;
        for (let o of wt)
          if (t.startsWith(o)) {
            ((t = t.slice(o.length)),
              o === "file:///" && (t = `/${t.replace(/^\/+/, "")}`),
              (n = !0));
            break;
          }
      }
      if (ie.test(t)) {
        let o = t.match(ie);
        o && (t = t.slice(o[0].length));
      }
      if (t.startsWith("//")) {
        let o = t.indexOf("/", 2);
        t = o === -1 ? "" : t.slice(o);
      }
      let i = t.indexOf("?");
      if (i !== -1) {
        let o = t.slice(i);
        Nt.test(o) && (t = t.slice(0, i));
      }
      return t;
    },
    Fe = (e) => {
      let t = Me(e);
      return !(!t || !Ce.test(t) || vt.test(t));
    },
    Yt = Symbol.for("react.context"),
    He = [],
    pe = null,
    Ie = Error(
      "Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render.",
    ),
    h = () => {
      let e = pe;
      return (e !== null && (pe = e.next), e);
    },
    T = (e) => e._currentValue,
    p = (e, t, r, n = null) => {
      He.push({
        displayName: n,
        primitive: e,
        stackError: Error(),
        value: t,
        dispatcherHookName: r,
      });
    },
    Qt = (e) => {
      if (typeof e == "object" && e) {
        let t = e;
        if (typeof t.then == "function") {
          let r = t;
          switch (r.status) {
            case "fulfilled":
              return (p("Promise", r.value, "Use"), r.value);
            case "rejected":
              throw r.reason;
          }
          throw (p("Unresolved", r, "Use"), Ie);
        }
        if (t.$$typeof === Yt && "_currentValue" in t) {
          let r = t,
            n = T(r);
          return (p("Context (use)", n, "Use", r.displayName || "Context"), n);
        }
      }
      throw Error("An unsupported type was passed to use(): " + String(e));
    },
    er = (e) => {
      let t = T(e);
      return (p("Context", t, "Context", e.displayName || null), t);
    },
    tr = (e) => {
      let t = h(),
        r = t === null ? (typeof e == "function" ? e() : e) : t.memoizedState;
      return (p("State", r, "State"), [r, () => {}]);
    },
    rr = (e, t, r) => {
      let n = h(),
        i = n === null ? (r === void 0 ? t : r(t)) : n.memoizedState;
      return (p("Reducer", i, "Reducer"), [i, () => {}]);
    },
    nr = (e) => {
      let t = h(),
        r = t === null ? { current: e } : t.memoizedState;
      return (p("Ref", r.current, "Ref"), r);
    },
    or = () => {
      let e = h();
      return (p("CacheRefresh", e === null ? () => {} : e.memoizedState, "CacheRefresh"), () => {});
    },
    ir = (e) => {
      (h(), p("LayoutEffect", e, "LayoutEffect"));
    },
    lr = (e) => {
      (h(), p("InsertionEffect", e, "InsertionEffect"));
    },
    ar = (e) => {
      (h(), p("Effect", e, "Effect"));
    },
    sr = (e) => {
      h();
      let t;
      (typeof e == "object" && e && "current" in e && (t = e.current),
        p("ImperativeHandle", t, "ImperativeHandle"));
    },
    ur = (e, t) => {
      p("DebugValue", typeof t == "function" ? t(e) : e, "DebugValue");
    },
    cr = (e) => {
      let t = h();
      return (p("Callback", t === null ? e : t.memoizedState[0], "Callback"), e);
    },
    fr = (e) => {
      let t = h(),
        r = t === null ? e() : t.memoizedState[0];
      return (p("Memo", r, "Memo"), r);
    },
    mr = (e, t) => {
      let r = h();
      h();
      let n = r === null ? t() : r.memoizedState;
      return (p("SyncExternalStore", n, "SyncExternalStore"), n);
    },
    dr = () => {
      let e = h();
      h();
      let t = e === null ? !1 : e.memoizedState;
      return (p("Transition", t, "Transition"), [t, () => {}]);
    },
    pr = (e) => {
      let t = h(),
        r = t === null ? e : t.memoizedState;
      return (p("DeferredValue", r, "DeferredValue"), r);
    },
    hr = () => {
      let e = h(),
        t = e === null ? "" : e.memoizedState;
      return (p("Id", t, "Id"), t);
    },
    gr = (e) => [],
    br = (e) => {
      let t = h(),
        r = t === null ? e : t.memoizedState;
      return (p("Optimistic", r, "Optimistic"), [r, () => {}]);
    },
    yr = (e, t) => {
      let r,
        n = null;
      if (e !== null) {
        let i = e.memoizedState;
        if (typeof i == "object" && i && "then" in i && typeof i.then == "function") {
          let o = i;
          switch (o.status) {
            case "fulfilled":
              r = o.value;
              break;
            case "rejected":
              n = o.reason;
              break;
            default:
              ((n = Ie), (r = o));
          }
        } else r = i;
      } else r = t;
      return { value: r, error: n };
    },
    We = (e) => (t, r) => {
      let n = h();
      (h(), h());
      let i = Error(),
        { value: o, error: l } = yr(n, r);
      if (
        (He.push({
          displayName: null,
          primitive: e,
          stackError: i,
          value: o,
          dispatcherHookName: e,
        }),
        l !== null)
      )
        throw l;
      return [o, () => {}, !1];
    },
    wr = We("ActionState"),
    Sr = {
      readContext: T,
      use: Qt,
      useCallback: cr,
      useContext: er,
      useEffect: ar,
      useImperativeHandle: sr,
      useLayoutEffect: ir,
      useInsertionEffect: lr,
      useMemo: fr,
      useReducer: rr,
      useRef: nr,
      useState: tr,
      useDebugValue: ur,
      useDeferredValue: pr,
      useTransition: dr,
      useSyncExternalStore: mr,
      useId: hr,
      useHostTransitionStatus: () => {
        let e = T({ _currentValue: null });
        return (p("HostTransitionStatus", e, "HostTransitionStatus"), e);
      },
      useFormState: We("FormState"),
      useActionState: wr,
      useOptimistic: br,
      useMemoCache: gr,
      useCacheRefresh: or,
      useEffectEvent: (e) => (h(), p("EffectEvent", e, "EffectEvent"), e),
    };
  /**
   * @license bippy
   *
   * Copyright (c) Aiden Bai
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */ (typeof Proxy > "u" ||
    new Proxy(Sr, {
      get(e, t) {
        if (Object.prototype.hasOwnProperty.call(e, t)) return e[t];
        let r = Error("Missing method in Dispatcher: " + t);
        throw ((r.name = "ReactDebugToolsUnsupportedHookError"), r);
      },
    }),
    yt());
  /**
   * @license bippy
   *
   * Copyright (c) Aiden Bai
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */ var Be = (e, t) => (e.length > t ? `${e.slice(0, t)}...` : e),
    C,
    vr = () => {
      if (C !== void 0) return C;
      let e = document.querySelector('script[src*="/_next/"]')?.src,
        t = e ? new URL(e).pathname : "",
        r = t.indexOf("/_next/");
      return ((C = r > 0 ? t.slice(0, r) : ""), C);
    },
    Nr = /^(?:\.\/)?\/?\([a-z][a-z0-9-]*\)\//,
    _r = (e) => {
      let t = Me(e);
      return ((t = t.replace(Nr, "")), t.startsWith("./") && (t = t.slice(2)), t);
    };
  var Er = (e) => e.startsWith("data-react-grab-");
  var xr = new Set(["_", "$", "motion.", "styled.", "chakra.", "ark.", "Primitive.", "Slot."]),
    kr = new Set([
      "InnerLayoutRouter",
      "RedirectErrorBoundary",
      "RedirectBoundary",
      "HTTPAccessFallbackErrorBoundary",
      "HTTPAccessFallbackBoundary",
      "LoadingBoundary",
      "ErrorBoundary",
      "InnerScrollAndFocusHandler",
      "ScrollAndFocusHandler",
      "RenderFromTemplateContext",
      "OuterLayoutRouter",
      "body",
      "html",
      "DevRootHTTPAccessFallbackBoundary",
      "AppDevOverlayErrorBoundary",
      "AppDevOverlay",
      "HotReload",
      "Router",
      "ErrorBoundaryHandler",
      "AppRouter",
      "ServerRoot",
      "SegmentStateProvider",
      "RootErrorBoundary",
      "LoadableComponent",
      "MotionDOMComponent",
    ]),
    Ar = new Set(["Suspense", "Fragment", "StrictMode", "Profiler", "SuspenseList"]),
    P,
    Ge = (e) => (
      e && (P = void 0),
      (P ??=
        typeof document < "u" &&
        !!(document.getElementById("__NEXT_DATA__") || document.querySelector("nextjs-portal"))),
      P
    ),
    Ue = (e) => {
      if (kr.has(e) || Ar.has(e)) return !0;
      for (let t of xr) if (e.startsWith(t)) return !0;
      return !1;
    },
    qe = (e) => !(!e || Ue(e) || e === "SlotClone" || e === "Slot"),
    F = (e) =>
      !(
        e.length <= 1 ||
        Ue(e) ||
        e[0] !== e[0].toUpperCase() ||
        e.endsWith("Provider") ||
        e.endsWith("Context")
      ),
    Ke = ["about://React/", "rsc://React/"],
    Or = (e) => Ke.some((t) => e.startsWith(t)),
    $r = (e) => {
      for (let t of Ke) {
        if (!e.startsWith(t)) continue;
        let r = e.indexOf("/", t.length),
          n = e.lastIndexOf("?");
        if (r > -1 && n > -1) return decodeURI(e.slice(r + 1, n));
      }
      return e;
    },
    Cr = async (e) => {
      let t = [],
        r = [];
      for (let o = 0; o < e.length; o++) {
        let l = e[o];
        !l.isServer ||
          !l.fileName ||
          (t.push(o),
          r.push({
            file: $r(l.fileName),
            methodName: l.functionName ?? "<unknown>",
            line1: l.lineNumber ?? null,
            column1: l.columnNumber ?? null,
            arguments: [],
          }));
      }
      if (r.length === 0) return e;
      let n = new AbortController(),
        i = setTimeout(() => n.abort(), 5e3);
      try {
        let o = await fetch(`${vr()}/__nextjs_original-stack-frames`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames: r, isServer: !0, isEdgeServer: !1, isAppDirectory: !0 }),
          signal: n.signal,
        });
        if (!o.ok) return e;
        let l = await o.json(),
          a = [...e];
        for (let f = 0; f < t.length; f++) {
          let m = l[f];
          if (m?.status !== "fulfilled") continue;
          let u = m.value?.originalStackFrame;
          if (!u?.file || u.ignored) continue;
          let c = t[f];
          a[c] = {
            ...e[c],
            fileName: u.file,
            lineNumber: u.line1 ?? void 0,
            columnNumber: u.column1 ?? void 0,
            isSymbolicated: !0,
          };
        }
        return a;
      } catch {
        return e;
      } finally {
        clearTimeout(i);
      }
    },
    Rr = (e) => {
      let t = new Map();
      return (
        W(
          e,
          (r) => {
            if (!Ve(r)) return !1;
            let n = ze(r._debugStack.stack);
            if (!n) return !1;
            for (let i of B(n))
              !i.functionName ||
                !i.fileName ||
                (Or(i.fileName) &&
                  (t.has(i.functionName) || t.set(i.functionName, { ...i, isServer: !0 })));
            return !1;
          },
          !0,
        ),
        t
      );
    },
    Tr = (e, t) => {
      if (!t.some((n) => n.isServer && !n.fileName && n.functionName)) return t;
      let r = Rr(e);
      return r.size === 0
        ? t
        : t.map((n) => {
            if (!n.isServer || n.fileName || !n.functionName) return n;
            let i = r.get(n.functionName);
            return i
              ? {
                  ...n,
                  fileName: i.fileName,
                  lineNumber: i.lineNumber,
                  columnNumber: i.columnNumber,
                }
              : n;
          });
    },
    Ze = (e) => {
      if (!j()) return e;
      let t = e;
      for (; t;) {
        if (y(t)) return t;
        t = t.parentElement;
      }
      return e;
    },
    he = new WeakMap(),
    jr = async (e) => {
      try {
        let t = y(e);
        if (!t) return null;
        let r = await Zt(t);
        return Ge() ? await Cr(Tr(t, r)) : r;
      } catch {
        return null;
      }
    },
    U = (e) => {
      if (!j()) return Promise.resolve([]);
      let t = Ze(e),
        r = he.get(t);
      if (r) return r;
      let n = jr(t);
      return (he.set(t, n), n);
    };
  var Xe = (e) => {
      if (!j()) return null;
      let t = y(Ze(e));
      if (!t) return null;
      let r = t.return;
      for (; r;) {
        if (ke(r)) {
          let n = x(r.type);
          if (n && qe(n)) return n;
        }
        r = r.return;
      }
      return null;
    },
    Lr = (e) =>
      e
        ? e.some(
            (t) =>
              !!(
                (t.fileName && Fe(t.fileName)) ||
                (t.isServer && (!t.functionName || F(t.functionName)))
              ),
          )
        : !1,
    Dr = (e, t) => {
      if (!j()) return [];
      let r = y(e);
      if (!r) return [];
      let n = [];
      return (
        W(
          r,
          (i) => {
            if (n.length >= t) return !0;
            if (ke(i)) {
              let o = x(i.type);
              o && qe(o) && n.push(o);
            }
            return !1;
          },
          !0,
        ),
        n
      );
    },
    Pr = (e, t = {}) => {
      let { maxLines: r = 3 } = t,
        n = Ge(),
        i = [];
      for (let o of e) {
        if (i.length >= r) break;
        let l = o.fileName && Fe(o.fileName);
        if (o.isServer && !l && (!o.functionName || F(o.functionName))) {
          i.push(`
  in ${o.functionName || "<anonymous>"} (at Server)`);
          continue;
        }
        if (l) {
          let a = `
  in `,
            f = o.functionName && F(o.functionName);
          (f && (a += `${o.functionName} (at `),
            (a += _r(o.fileName)),
            n &&
              o.lineNumber &&
              ((a += `:${o.lineNumber}`), o.columnNumber && (a += `:${o.columnNumber}`)),
            f && (a += ")"),
            i.push(a));
        }
      }
      return i.join("");
    },
    Je = async (e, t = {}) => {
      let r = t.maxLines ?? 3,
        n = await U(e);
      if (n && Lr(n)) return Pr(n, t);
      let i = Dr(e, r);
      return i.length > 0
        ? i
            .map(
              (o) => `
  in ${o}`,
            )
            .join("")
        : "";
    };
  var Vr = (e) => Be(e, 15);
  var Ye = (e) => {
    let t = ee(e),
      r =
        e instanceof HTMLElement
          ? (e.innerText?.trim() ?? e.textContent?.trim() ?? "")
          : (e.textContent?.trim() ?? ""),
      n = "";
    for (let { name: s, value: d } of e.attributes) Er(s) || (n += ` ${s}="${Vr(d)}"`);
    let i = [],
      o = [],
      l = !1,
      a = Array.from(e.childNodes);
    for (let s of a)
      s.nodeType !== Node.COMMENT_NODE &&
        (s.nodeType === Node.TEXT_NODE
          ? s.textContent && s.textContent.trim().length > 0 && (l = !0)
          : s instanceof Element && (l ? o.push(s) : i.push(s)));
    let f = (s) =>
        s.length === 0
          ? ""
          : s.length <= 2
            ? s.map((d) => `<${ee(d)} ...>`).join(`
  `)
            : `(${s.length} elements)`,
      m = "",
      u = f(i);
    (u &&
      (m += `
  ${u}`),
      r.length > 0 &&
        (m += `
  ${Be(r, 100)}`));
    let c = f(o);
    return (
      c &&
        (m += `
  ${c}`),
      m.length > 0
        ? `<${t}${n}>${m}
</${t}>`
        : `<${t}${n} />`
    );
  };
  var H = !1,
    N = new Map(),
    ge = -1,
    be = new WeakSet(),
    V = new Map(),
    ye = new Map(),
    zr = (e) =>
      be.has(e)
        ? !0
        : !H || !("gsapVersions" in window) || !(Error().stack ?? "").includes("_tick")
          ? !1
          : (be.add(e), !0);
  typeof window < "u" &&
    ((window.requestAnimationFrame = (e) => {
      if (!zr(e)) return te(e);
      if (H) {
        let r = ge--;
        return (N.set(r, e), r);
      }
      let t = te((r) => {
        if (H) {
          let n = ge--;
          (N.set(n, e), V.set(t, n));
          return;
        }
        e(r);
      });
      return t;
    }),
    (window.cancelAnimationFrame = (e) => {
      if (N.has(e)) {
        N.delete(e);
        return;
      }
      let t = ye.get(e);
      if (t !== void 0) {
        (re(t.nativeId), ye.delete(e));
        return;
      }
      let r = V.get(e);
      if (r !== void 0) {
        (N.delete(r), V.delete(e));
        return;
      }
      re(e);
    }));
  var an = `
[${Q}],
[${Q}] * {
  animation-play-state: paused !important;
  transition: none !important;
}
`;
  /**
   * @license MIT
   *
   * Copyright (c) 2025 Aiden Bai
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */ var Mr = new Set(["role", "name", "aria-label", "rel", "href"]),
    A = (e) => {
      if (!/^[a-z\-]{3,}$/i.test(e)) return !1;
      let t = e.split(/-|[A-Z]/);
      for (let r of t) if (r.length <= 2 || /[^aeiou]{4,}/i.test(r)) return !1;
      return !0;
    },
    Fr = (e, t) => {
      let r = Mr.has(e) || (e.startsWith("data-") && A(e)),
        n = (A(t) && t.length < 100) || (t.startsWith("#") && A(t.slice(1)));
      return r && n;
    },
    K = (e) => {
      let t = e[0].name;
      for (let r = 1; r < e.length; r++) t = `${e[r].name} > ${t}`;
      return t;
    },
    Qe = (e) => {
      let t = 0;
      for (let r of e) t += r.penalty;
      return t;
    },
    et = (e, t) => Qe(e) - Qe(t),
    Z = (e, t) => {
      let r = e.parentNode;
      if (!r) return;
      let n = r.firstChild;
      if (!n) return;
      let i = 0;
      for (
        ;
        n &&
        (n.nodeType === Node.ELEMENT_NODE && (t === void 0 || n.tagName.toLowerCase() === t) && i++,
        n !== e);
      )
        n = n.nextSibling;
      return i;
    },
    Hr = (e, t) => (e === "html" ? "html" : `${e}:nth-child(${t})`),
    rt = (e, t) => (e === "html" ? "html" : `${e}:nth-of-type(${t})`),
    Ir = (e, t) => {
      let r = [],
        n = e.getAttribute("id"),
        i = e.tagName.toLowerCase();
      n && A(n) && r.push({ name: `#${CSS.escape(n)}`, penalty: 0 });
      for (let a of e.classList) A(a) && r.push({ name: `.${CSS.escape(a)}`, penalty: 1 });
      for (let a of e.attributes)
        t(a.name, a.value) &&
          r.push({ name: `[${CSS.escape(a.name)}="${CSS.escape(a.value)}"]`, penalty: 2 });
      r.push({ name: i, penalty: 5 });
      let o = Z(e, i);
      o !== void 0 && r.push({ name: rt(i, o), penalty: 10 });
      let l = Z(e);
      return (l !== void 0 && r.push({ name: Hr(i, l), penalty: 50 }), r);
    },
    X = (e, t = we, r = []) => {
      if (t <= 0) return [];
      if (e.length === 0) return [r];
      let n = [];
      for (let i of e[0]) {
        let o = t - n.length;
        if (o <= 0) break;
        n.push(...X(e.slice(1), o, [...r, i]));
      }
      return n;
    },
    Wr = (e, t) => {
      let r = t.getRootNode?.();
      return r instanceof ShadowRoot ? r : e.nodeType === Node.DOCUMENT_NODE ? e : e.ownerDocument;
    },
    J = (e, t) => t.querySelectorAll(K(e)).length === 1,
    Br = (e, t) => {
      let r = e,
        n = [];
      for (; r && r !== t;) {
        let i = r.tagName.toLowerCase(),
          o = Z(r, i);
        if (o === void 0) return;
        (n.push({ name: rt(i, o), penalty: 10 }), (r = r.parentElement));
      }
      return J(n, t) ? n : void 0;
    },
    Gr = (e, t, r, n) => {
      if (e.nodeType !== Node.ELEMENT_NODE)
        throw Error("Can't generate CSS selector for non-element node type.");
      if (e.tagName.toLowerCase() === "html") return "html";
      let i = Wr(t, e),
        o = Date.now(),
        l = [],
        a = e,
        f = 0,
        m;
      for (; a && a !== i && !m;)
        if ((l.push(Ir(a, n)), (a = a.parentElement), f++, f >= 3)) {
          let u = X(l);
          u.sort(et);
          for (let c of u) {
            if (Date.now() - o > r) {
              let s = Br(e, i);
              if (!s) throw Error(`Timeout: Can't find a unique selector after ${r}ms`);
              return K(s);
            }
            if (J(c, i)) {
              m = c;
              break;
            }
          }
        }
      if (!m && f < 3) {
        let u = X(l);
        u.sort(et);
        for (let c of u) {
          if (Date.now() - o > r) break;
          if (J(c, i)) {
            m = c;
            break;
          }
        }
      }
      if (!m) throw Error("Selector was not found.");
      return K(m);
    },
    nt = (e) =>
      typeof CSS < "u" && typeof CSS.escape == "function"
        ? CSS.escape(e)
        : e.replace(/[^a-zA-Z0-9_-]/g, (t) => `\\${t}`),
    ot = (e) => e.ownerDocument.body ?? e.ownerDocument.documentElement,
    it = new Set([
      "data-testid",
      "data-test-id",
      "data-test",
      "data-cy",
      "data-qa",
      "aria-label",
      "role",
      "name",
      "title",
      "alt",
    ]),
    lt = (e) => e.length > 0 && e.length <= 120,
    q = (e, t) => {
      try {
        let r = e.ownerDocument.querySelectorAll(t);
        return r.length === 1 && r[0] === e;
      } catch {
        return !1;
      }
    },
    Ur = (e) => {
      if (e instanceof HTMLElement && e.id) {
        let t = `#${nt(e.id)}`;
        if (q(e, t)) return t;
      }
      for (let t of it) {
        let r = e.getAttribute(t);
        if (!r || !lt(r)) continue;
        let n = `[${t}=${JSON.stringify(r)}]`;
        if (q(e, n)) return n;
        let i = `${e.tagName.toLowerCase()}${n}`;
        if (q(e, i)) return i;
      }
      return null;
    },
    qr = (e) => {
      let t = [],
        r = ot(e),
        n = e;
      for (; n;) {
        if (n instanceof HTMLElement && n.id) {
          t.unshift(`#${nt(n.id)}`);
          break;
        }
        let i = n.parentElement;
        if (!i) {
          t.unshift(n.tagName.toLowerCase());
          break;
        }
        let o = Array.from(i.children).indexOf(n),
          l = o >= 0 ? o + 1 : 1;
        if ((t.unshift(`${n.tagName.toLowerCase()}:nth-child(${l})`), i === r)) {
          t.unshift(r.tagName.toLowerCase());
          break;
        }
        n = i;
      }
      return t.join(" > ");
    },
    at = (e, t = !0) => {
      let r = Ur(e);
      if (r) return r;
      if (t)
        try {
          let n = Gr(e, ot(e), 200, (i, o) => Fr(i, o) || (it.has(i) && lt(o)));
          if (n) return n;
        } catch {}
      return qr(e);
    },
    Kr = new Map(
      ["top", "right", "bottom", "left"].flatMap((e) => [
        [`border-${e}-style`, e],
        [`border-${e}-color`, e],
      ]),
    ),
    k = null,
    tt = new Map(),
    Zr = () =>
      k ||
      ((k = document.createElement("iframe")),
      (k.style.cssText =
        "position:fixed;left:-9999px;width:0;height:0;border:none;visibility:hidden;"),
      document.body.appendChild(k),
      k),
    Xr = (e) => {
      let t = tt.get(e);
      if (t) return t;
      let r = Zr(),
        n = r.contentDocument,
        i = n.createElement(e);
      n.body.appendChild(i);
      let o = r.contentWindow.getComputedStyle(i),
        l = new Map();
      for (let a of I) {
        let f = o.getPropertyValue(a);
        f && l.set(a, f);
      }
      return (i.remove(), tt.set(e, l), l);
    },
    Jr = (e, t) => {
      let r = Kr.get(e);
      if (!r) return !1;
      let n = t.getPropertyValue(`border-${r}-width`);
      return n === "0px" || n === "0";
    },
    st = (e) => {
      let t = Xr(e.tagName.toLowerCase()),
        r = getComputedStyle(e),
        n = [];
      for (let l of I) {
        let a = r.getPropertyValue(l);
        a && a !== t.get(l) && (Jr(l, r) || n.push(`${l}: ${a};`));
      }
      let i = e.getAttribute("class")?.trim(),
        o = n.join(`
`);
      return i
        ? o
          ? `className: ${i}

${o}`
          : `className: ${i}`
        : o;
    };
  /**
   * @license MIT
   *
   * Copyright (c) 2025 Aiden Bai
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */ var ut = async (e) => {
    let t = (await U(e)) ?? [],
      r = await Je(e);
    return {
      element: e,
      htmlPreview: Ye(e),
      stackString: r,
      stack: t,
      componentName: Xe(e),
      fiber: y(e),
      selector: at(e),
      styles: st(e),
    };
  };
  globalThis.__adeReactGrab = ut;
})();
