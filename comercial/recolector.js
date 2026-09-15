/* ============================================================
   RECOLECTOR DE BIONEXO — corre DENTRO de bionexo-ar.bionexo.com
   ============================================================
   Cómo llega acá: el bookmarklet «Recolectar Bionexo» (se arma en
   comercial/recolector.html) mete la clave en window.__BX_KEY y carga este
   archivo. Este archivo NO lleva la clave: el repo del Core es público.

   POR QUÉ CORRE EN EL NAVEGADOR Y NO EN UN SERVIDOR: Bionexo no dio
   credenciales de API. La única forma de leer el historial es con la sesión
   del proveedor ya abierta — la que tiene Natividad en su pantalla. Un
   servidor tendría que guardar su contraseña; esto no guarda nada.

   ══ LA REGLA DE ORO: IR DESPACIO ══
   El 15/09/2026 se midió el límite: después de ~60 consultas seguidas Bionexo
   DEJÓ DE RESPONDER (la cuenta quedó sana, pero la extracción se cortó y hubo
   que abandonar). Por eso:

     · pausa de varios segundos entre pedidos, con variación al azar
     · si Bionexo empieza a tardar, la pausa se agranda sola
     · si tarda demasiado o falla dos veces seguidas, FRENA y avisa
     · si aparece la pantalla de login, FRENA (la sesión se cerró)
     · cada pedido se guarda apenas se lee: cortar a la mitad no pierde nada

   Esto NO es una carrera. Puede tardar días y está bien: el histórico se
   levanta una sola vez y después sólo entran los pedidos nuevos del día.
   ============================================================ */
(function () {
  "use strict";

  if (window.__BX_CORRIENDO) { alert("El recolector ya está abierto en esta pestaña."); return; }
  window.__BX_CORRIENDO = true;

  var KEY = window.__BX_KEY || "";
  var BASE_FN = "https://yxotopoklgjowcudveoj.supabase.co/functions/v1/";

  /* OJO CON EL NOMBRE. En Supabase la function se llama de verdad "quick-responder":
     al crearla desde el panel, Supabase pre-llena un nombre al azar y el título que se
     ve arriba ("bionexo-ingesta") es OTRO campo. NO "corregir" esta lista dejando sólo
     bionexo-ingesta sin haber renombrado la function primero — se rompe la recolección
     y el error es confuso ("Failed to fetch").
     Se prueban los dos y se recuerda el que contesta: el día que se recree con el
     nombre bueno, esto sigue andando solo. */
  var NOMBRES = ["bionexo-ingesta", "quick-responder"];
  var elQueAnda = null;

  /* La anon key va SÓLO para pasar el portero de Supabase: una function desplegada
     desde el panel queda con verify_jwt activo y rechaza con 401 a quien llame sin
     Authorization — y el fallo es MUDO (pasó el 5/9/2026 con vademecum-cargar, el
     cosechador dejó de cargar en silencio). Es una llave publicable, está en el repo
     del Core. El permiso de verdad lo da x-connector-key, que no está acá. */
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4b3RvcG9rbGdqb3djdWR2ZW9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTE3OTAsImV4cCI6MjEwMDA2Nzc5MH0.39DqIenUuRZovmgG89R_JgHco4Lg6OvmP9AgF1Hd7rQ";

  /* ---- ritmo (se puede tocar desde el panel) ---- */
  var RITMO = { pausa: 5000, minPausa: 3000, maxPausa: 45000, lento: 6000, cortar: 25000 };
  var ST = { activo: false, hechos: 0, fallos: 0, seguidos: 0, pend: [], log: [], ultimoMs: 0 };

  /* ================= utilidades ================= */
  var T = function (el) { return ((el && el.textContent) || "").replace(/\s+/g, " ").trim(); };
  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter(ms) { return Math.round(ms * (0.75 + Math.random() * 0.5)); }

  function nota(txt, tipo) {
    ST.log.unshift({ t: new Date().toLocaleTimeString("es-AR").slice(0, 5), txt: txt, tipo: tipo || "" });
    if (ST.log.length > 40) ST.log.pop();
    pintar();
  }

  /* Un fetch que se rinde solo. Sin esto, una respuesta que nunca llega deja la
     pestaña colgada para siempre — pasó y hubo que recargar perdiendo el avance. */
  function traer(url, ms) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, ms || RITMO.cortar);
    var t0 = Date.now();
    return fetch(url, { signal: ctrl.signal, credentials: "same-origin" })
      .then(function (r) { return r.text(); })
      .then(function (txt) { clearTimeout(to); ST.ultimoMs = Date.now() - t0; return txt; })
      .catch(function (e) { clearTimeout(to); ST.ultimoMs = Date.now() - t0; throw e; });
  }

  /* Si Bionexo nos devolvió el login, la sesión se cerró: no tiene sentido seguir
     (y seguir golpeando la puerta es justo lo que no hay que hacer). */
  function esLogin(html) { return /jsp\/login\/login\.jsp|name="clave"|Bienvenido a/i.test(html.slice(0, 4000)); }

  /* ================= parseo ================= */
  /* Los IDs y títulos del índice NO son texto de la celda: vienen adentro de un
     document.write(getTransaccionLink('id','título',...)). Hay que sacarlos del HTML. */
  function parseIndice(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll("tr"), function (tr) {
      var h = tr.innerHTML;
      var ms = [], re = /getTransaccionLink\(\s*'(\d{7,9})'\s*,\s*'([\s\S]*?)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g, m;
      while ((m = re.exec(h))) ms.push(m);
      if (!ms.length) return;
      var cands = ms.map(function (x) { return x[2]; }).filter(function (t) { return !/<img|^Visualizar$/i.test(t.trim()); });
      cands.sort(function (a, b) { return b.length - a.length; });
      var cels = Array.prototype.map.call(tr.cells, T).filter(function (x) { return x && !/^function|document\.write/.test(x); });
      var cmp = cels[cels.length - 3] || "";
      var items = h.match(/(\d+)\s*iten/i);
      out.push({
        id: ms[0][1],
        renglones: items ? +items[1] : 0,
        tipo: (cels.filter(function (x) { return /Cotizaci[oó]n (Normal|de urgencia|para compras)|^PDC$/i.test(x); })[0] || ""),
        titulo: (cands[0] || "").slice(0, 200),
        cliente: cmp.replace(/(\d{2}-\d{8}-\d)[\s\S]*$/, "").trim(),
        cuit: (cmp.match(/\d{2}-\d{8}-\d/) || [""])[0],
        vence: cels[cels.length - 2] || "",
        estado: cels[cels.length - 1] || ""
      });
    });
    return out;
  }

  /* El detalle se corta por etiquetas con indexOf, NUNCA con expresiones tipo
     [\s\S]{3,90}? — esas cuelgan el navegador por backtracking en pedidos grandes
     (probado: un pedido de 133 renglones congeló la pestaña). */
  function entre(s, a, b) {
    var i = s.indexOf(a); if (i < 0) return "";
    var d = i + a.length, j = b ? s.indexOf(b, d) : -1;
    return s.slice(d, j < 0 ? d + 90 : j).trim();
  }
  function parseDetalle(html) {
    var txt = (new DOMParser().parseFromString(html, "text/html").body.textContent || "").replace(/\s+/g, " ");
    return txt.split("Código: ").slice(1).map(function (b) {
      var precio = entre(b, "Precio Unitario ", " por ");   // la unidad varía: Unidades, Botella, Caja…
      var nuestro = entre(b, "Descripción del Producto ", "Precio Unitario");
      var iEst = b.lastIndexOf("Estado ");
      var est = iEst < 0 ? "" : (b.slice(iEst + 7).match(/^([A-Za-zÁÉÍÓÚáéíóúñ]+)/) || ["", ""])[1];
      return {
        cod: (b.match(/^(\d+)/) || ["", ""])[1],
        prod: entre(b, "Producto: ", "Marca(s)"),
        pref: entre(b, "Marca(s) Preferida(s): ", "Cantidad").replace(/Cantitades individuales$/, "").trim(),
        cant: parseInt(entre(b, "Cantidad: ", "Programación").replace(/\./g, ""), 10) || 0,
        nuestro: nuestro,
        codEyg: (nuestro.match(/^\[(\d+)\]/) || ["", ""])[1],   // el [15346]: el puente con Odoo
        precio: precio.replace(/^\$\s*/, "").replace(/\./g, "").replace(",", "."),
        marca: entre(b, "Marca / Fabricante ", "Presentación"),
        pres: entre(b, "Presentación ", "Comentario"),
        estado: est
      };
    });
  }

  /* ================= hablar con el Core ================= */
  function ingesta(payload) {
    var orden = elQueAnda ? [elQueAnda] : NOMBRES;
    return (function probar(i) {
      if (i >= orden.length) throw new Error("no encuentro la función en Supabase");
      return fetch(BASE_FN + orden[i], {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-connector-key": KEY, "Authorization": "Bearer " + ANON, "apikey": ANON },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (r.status === 404) return probar(i + 1);   // ese nombre no existe: probar el otro
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || ("http " + r.status));
          elQueAnda = orden[i];
          return j;
        });
      });
    })(0);
  }

  /* ================= el trabajo ================= */
  function leerIndice() {
    nota("Leyendo el listado de cotizaciones…");
    var todas = [], pag = 0;
    function siguiente() {
      if (!ST.activo || pag > 40) return Promise.resolve(todas);
      var body = "MaxRows=20&PageID=" + pag + "&OrderBy=ID_TRANSACCION+DESC&filtro_artigo=&filtro_pdc=&filtro_razao_social=";
      return fetch("/jsp/vender/TransaccionesVenta.jsp", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body
      }).then(function (r) { return r.text(); }).then(function (html) {
        if (esLogin(html)) throw new Error("SESION");
        var filas = parseIndice(html);
        if (!filas.length) return todas;
        todas = todas.concat(filas);
        pag++;
        nota("Listado: " + todas.length + " cotizaciones");
        return dormir(jitter(1500)).then(siguiente);
      });
    }
    return siguiente().then(function (t) {
      if (!t.length) return t;
      return ingesta({ op: "indice", filas: t }).then(function () {
        nota("Listado guardado: " + t.length + " cotizaciones", "ok");
        return t;
      });
    });
  }

  function unPedido(p) {
    return traer("/jsp/vender/v_rpdc.jsp?nivel=1&id=" + p.id).then(function (html) {
      if (esLogin(html)) throw new Error("SESION");
      var rens = parseDetalle(html);
      return ingesta({ op: "detalle", id: p.id, renglones: rens }).then(function (res) {
        ST.hechos++; ST.seguidos = 0;
        nota("#" + p.id + " · " + res.renglones + " renglones · " + res.cotizados + " cotizados · " + res.ganados + " ganados", "ok");

        /* El freno que importa: si Bionexo se pone lento, aflojamos ANTES de que
           nos corte. Si va bien, volvemos de a poco al ritmo normal. */
        if (ST.ultimoMs > RITMO.lento) {
          RITMO.pausa = Math.min(RITMO.maxPausa, Math.round(RITMO.pausa * 1.8));
          nota("Bionexo tardó " + (ST.ultimoMs / 1000).toFixed(1) + "s — bajo el ritmo a " + (RITMO.pausa / 1000).toFixed(0) + "s", "warn");
        } else if (RITMO.pausa > RITMO.minPausa) {
          RITMO.pausa = Math.max(RITMO.minPausa, Math.round(RITMO.pausa * 0.9));
        }
      });
    });
  }

  function ciclo() {
    if (!ST.activo) return;
    if (!ST.pend.length) {
      ingesta({ op: "pendientes", limite: 25 }).then(function (r) {
        ST.pend = r.pendientes || [];
        if (!ST.pend.length) { nota("No queda nada pendiente. Terminado.", "ok"); parar(); return; }
        ciclo();
      }).catch(function (e) { nota("No pude pedir la lista: " + e.message, "err"); parar(); });
      return;
    }
    var p = ST.pend.shift();
    unPedido(p)
      .then(function () { return dormir(jitter(RITMO.pausa)); })
      .then(ciclo)
      .catch(function (e) {
        if (String(e.message) === "SESION") {
          nota("Se cerró la sesión de Bionexo. Volvé a entrar y arrancá de nuevo: lo leído está guardado.", "err");
          parar(); return;
        }
        ST.fallos++; ST.seguidos++;
        nota("Falló #" + p.id + ": " + String(e.message).slice(0, 60), "err");
        if (ST.seguidos >= 2) {
          nota("Dos fallas seguidas. Freno para no forzar a Bionexo. Probá más tarde.", "err");
          parar(); return;
        }
        RITMO.pausa = Math.min(RITMO.maxPausa, RITMO.pausa * 2);
        dormir(jitter(RITMO.pausa)).then(ciclo);
      });
  }

  function arrancar() {
    if (!KEY) { alert("Falta la clave. Rearmá el favorito desde el Core."); return; }
    ST.activo = true; pintar();
    ingesta({ op: "estado" })
      .then(function (e) {
        if (!e.cotizaciones) return leerIndice();
        nota("Ya hay " + e.cotizaciones + " cotizaciones guardadas, faltan " + e.faltan + " detalles");
      })
      .then(ciclo)
      .catch(function (err) {
        nota(String(err.message) === "SESION" ? "La sesión de Bionexo está cerrada: entrá y reintentá." : ("Error: " + err.message), "err");
        parar();
      });
  }
  function parar() { ST.activo = false; pintar(); }

  /* ================= el panel ================= */
  var caja = document.createElement("div");
  caja.id = "bx-panel";
  caja.style.cssText = "position:fixed;right:18px;bottom:18px;width:340px;max-height:74vh;z-index:2147483647;" +
    "background:#fff;border:1px solid #DCE8E6;border-radius:14px;box-shadow:0 10px 40px rgba(6,65,62,.22);" +
    "font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;color:#0E1F1D;overflow:hidden;display:flex;flex-direction:column";
  document.body.appendChild(caja);

  function pintar() {
    var b = ST.activo
      ? '<button id="bx-stop" style="flex:1;background:#B0413E;color:#fff;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:700;cursor:pointer">Parar</button>'
      : '<button id="bx-go" style="flex:1;background:#048782;color:#fff;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:700;cursor:pointer">Empezar</button>';
    caja.innerHTML =
      '<div style="background:#04635F;color:#fff;padding:11px 14px;display:flex;align-items:center;gap:9px">' +
        '<b style="flex:1;font-size:13px">Recolector · Bionexo</b>' +
        '<span style="font-size:11px;opacity:.85">' + (ST.activo ? "trabajando" : "en pausa") + "</span>" +
        '<span id="bx-x" style="cursor:pointer;font-size:17px;line-height:1;opacity:.8">×</span>' +
      "</div>" +
      '<div style="padding:12px 14px;display:flex;gap:8px;border-bottom:1px solid #EEF4F3">' +
        '<div style="flex:1"><div style="font-size:10px;letter-spacing:.6px;color:#8A9A97;font-weight:800">LEÍDOS</div>' +
          '<div style="font-size:21px;font-weight:800">' + ST.hechos + "</div></div>" +
        '<div style="flex:1"><div style="font-size:10px;letter-spacing:.6px;color:#8A9A97;font-weight:800">EN COLA</div>' +
          '<div style="font-size:21px;font-weight:800">' + ST.pend.length + "</div></div>" +
        '<div style="flex:1"><div style="font-size:10px;letter-spacing:.6px;color:#8A9A97;font-weight:800">RITMO</div>' +
          '<div style="font-size:21px;font-weight:800">' + (RITMO.pausa / 1000).toFixed(0) + 's</div></div>' +
      "</div>" +
      '<div style="padding:10px 14px;display:flex;gap:8px">' + b + "</div>" +
      '<div style="padding:0 14px 12px;overflow:auto;flex:1">' +
        ST.log.map(function (l) {
          var c = l.tipo === "err" ? "#B0413E" : l.tipo === "ok" ? "#1E7D46" : l.tipo === "warn" ? "#B7791F" : "#5F716E";
          return '<div style="padding:5px 0;border-top:1px solid #F2F7F6;line-height:1.45;color:' + c + '">' +
            '<span style="color:#8A9A97;font-size:11px">' + l.t + "</span> " + l.txt + "</div>";
        }).join("") +
        (ST.log.length ? "" : '<div style="color:#8A9A97;padding:14px 0;line-height:1.5">Dale a Empezar. Podés seguir usando Bionexo mientras trabaja — va despacio a propósito.</div>') +
      "</div>";
    var g = document.getElementById("bx-go"), s = document.getElementById("bx-stop"), x = document.getElementById("bx-x");
    if (g) g.onclick = arrancar;
    if (s) s.onclick = function () { nota("Frenado a mano. Lo leído está guardado."); parar(); };
    if (x) x.onclick = function () { parar(); caja.remove(); window.__BX_CORRIENDO = false; };
  }

  pintar();
})();
