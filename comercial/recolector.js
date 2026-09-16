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

  /* El error más fácil de cometer: apretar el favorito desde el Core en vez de desde
     Bionexo. Sin este guardia el recolector pedía /jsp/vender/... al dominio equivocado,
     no encontraba nada y anunciaba «no queda nada pendiente. Terminado» — el peor final
     posible, porque parece éxito. Pasó en la primera prueba real (15/9/2026). */
  var EN_BIONEXO = /bionexo/i.test(location.hostname);

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
      .then(function (r) { ST.urlFinal = r.url || ""; return r.text(); })
      .then(function (txt) { clearTimeout(to); ST.ultimoMs = Date.now() - t0; return txt; })
      .catch(function (e) { clearTimeout(to); ST.ultimoMs = Date.now() - t0; throw e; });
  }

  /* Si Bionexo nos devolvió el login, la sesión se cerró: no tiene sentido seguir
     (y seguir golpeando la puerta es justo lo que no hay que hacer).

     SE MIRA LA URL FINAL, no sólo el HTML. Cuando la sesión cae, Bionexo redirige
     a login.jsp y el fetch sigue el redirect: el texto que llega es el del login,
     pero sus marcas pueden caer más allá del pedazo que se revisaba, y entonces
     pasaba por una página normal y vacía. Resultado: decía «no hay pedidos de la
     zona» cuando en realidad estábamos afuera. La URL final no miente. */
  function esLogin(html) {
    if (/\/login\/|sign_in|bioidcallback/i.test(ST.urlFinal || "")) return true;
    return /jsp\/login\/login\.jsp|name=["']clave["']|Bienvenido a|type=["']password["']/i.test(String(html || ""));
  }

  /* La sesión se cae seguido. Volver a entrar no exige tipear nada mientras el
     SSO siga vivo: al abrir la pantalla de ingreso, redirige solo y la renueva. */
  function reabrirSesion() {
    window.open("https://bioid-shared.bionexo.com/users/sign_in?locale=es-AR", "_blank");
    nota("Abrí la pestaña de ingreso. Cuando estés adentro, volvé acá y probá de nuevo.", "warn");
  }

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
      /* Cero filas NO es "ya está todo": es que la lectura no funcionó. Avisarlo fuerte,
         porque seguir de largo termina en un «terminado» que parece éxito y no lo es. */
      if (!t.length) throw new Error("VACIO");
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
          nota("Se cerró la sesión de Bionexo. Lo leído está guardado.", "err");
          reabrirSesion();
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

  /* Copiar los renglones del pedido que se está mirando, para pegarlos en
     «Cotizar pedido de plataforma» del Core. Es solo lectura de la pantalla
     actual: no consulta nada, así que no molesta a Bionexo. */
  function copiarRenglones() {
    var txt = (document.body.textContent || "").replace(/\s+/g, " ");
    var partes = txt.split("Código: ").slice(1);
    if (!partes.length) { nota("Esta pantalla no es un pedido. Abrí una cotización y probá de nuevo.", "err"); return; }
    var lineas = partes.map(function (b) {
      var cod = (b.match(/^(\d+)/) || ["", ""])[1];
      var prod = entre(b, "Producto: ", "Marca(s)");
      var cant = entre(b, "Cantidad: ", "Programación").replace(/\./g, "");
      return cod + " · " + prod + " · " + (parseInt(cant, 10) || 0);
    });
    // El id del pedido viaja adelante: así el Core puede avisar después si se
    // está por llenar OTRO pedido con estos precios.
    var salida = "# pedido " + idPedido() + "\n" + lineas.join("\n");
    var ta = document.createElement("textarea");
    ta.value = salida;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); nota("Copiados " + lineas.length + " renglones. Pegalos en el Core → Cotizar pedido.", "ok"); }
    catch (e) { nota("No pude copiar solo. Copiá esto a mano: " + salida.slice(0, 120), "err"); }
    ta.remove();
  }

  function idPedido() {
    var m = location.search.match(/[?&]id=(\d+)/);
    return m ? m[1] : "";
  }

  /* ============ PEDIDOS ABIERTOS DE LA ZONA ============
     EyG vende sólo en Santa Fe: de los ~229 pedidos que se publican por día,
     unos 17 caen acá. Esto trae esos —cabecera y renglones— al Core, para
     poder mirar qué piden y armar la cotización sin ir y venir a Bionexo.
     Como son pocos, se pueden traer con el detalle completo sin forzar nada. */
  var PROVINCIAS = ["SFE"];   // si algún día se vende en otra, se agrega acá

  /* Bionexo escribe la fecha de DOS maneras según la pantalla: la cartelera usa
     «16/09/2026 11:00» (año de 4 dígitos) y Transacciones «16/09/26 10:00» (de
     2). El servidor espera la corta, y al mandarle la larga leía «20» como año
     y «26» como hora → «2020-09-16T26:00:00», que Postgres rechaza entero y
     tira TODO el lote. Se normaliza acá antes de mandar. */
  function fechaCorta(v) {
    var m = String(v || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return "";
    var dd = ("0" + m[1]).slice(-2), mm = ("0" + m[2]).slice(-2);
    var aa = m[3].length === 4 ? m[3].slice(2) : ("0" + m[3]).slice(-2);
    var hh = m[4] != null ? ("0" + m[4]).slice(-2) : "00";
    var mi = m[5] != null ? m[5] : "00";
    if (+hh > 23 || +mi > 59) { hh = "00"; mi = "00"; }   // antes que una fecha imposible, sin hora
    return dd + "/" + mm + "/" + aa + " " + hh + ":" + mi;
  }

  /* ¿POR QUÉ NO HAY UN BOTÓN EN EL CORE QUE HAGA ESTO?
     Porque el navegador no deja que un sitio (drogueriaeyg.com.ar) lea las
     páginas de otro (bionexo-ar.bionexo.com), ni le preste la sesión abierta.
     Es una defensa del navegador contra el robo de sesiones, y está bien que
     exista. Por eso el código tiene que correr DENTRO de Bionexo.
     Lo más cerca del botón soñado es esto: dejar la pestaña de Bionexo abierta
     —que igual se tiene abierta todo el día— y que sincronice sola cada tanto.
     La otra opción sería una extensión de Chrome propia; se puede, pero hay
     que instalarla en cada máquina y mantenerla. */
  var AUTO_MIN = 30;
  var _auto = null;
  function autoEncendido(){ try{ return localStorage.getItem("bx_auto")==="1"; }catch(e){ return false; } }
  function prenderAuto(on){
    try{ localStorage.setItem("bx_auto", on?"1":"0"); }catch(e){}
    if(_auto){ clearInterval(_auto); _auto=null; }
    if(on){
      _auto = setInterval(function(){
        if(ST.activo) return;                       // no pisar una corrida en curso
        nota("Sincronización automática…");
        traerAbiertos();
      }, AUTO_MIN*60000);
      nota("Listo: sincroniza solo cada "+AUTO_MIN+" minutos mientras esta pestaña siga abierta.", "ok");
    } else {
      nota("Sincronización automática apagada.");
    }
    pintar();
  }
  function esDeLaZona(txtFila) {
    return PROVINCIAS.some(function (p) { return new RegExp("/\\s*" + p + "\\s*$", "i").test(txtFila.trim()); });
  }

  async function traerAbiertos() {
    if (!EN_BIONEXO) { nota("Esto se toca estando dentro de Bionexo.", "err"); return; }
    if (!KEY) { alert("Falta la clave. Rearmá el favorito desde el Core."); return; }
    ST.activo = true; pintar();
    try {
      nota("Leyendo la cartelera…");
      var html = await traer("/jsp/vender/CarteleraVentas24h.jsp");
      if (esLogin(html)) throw new Error("SESION");
      var doc = new DOMParser().parseFromString(html, "text/html");
      var mios = [];
      Array.prototype.forEach.call(doc.querySelectorAll("tr"), function (tr) {
        var c = Array.prototype.map.call(tr.cells || [], T);
        if (c.length < 7) return;
        var loc = c[c.length - 1] || "";
        if (!esDeLaZona(loc)) return;
        mios.push({ id: c[2], vence: c[1], titulo: (c[4] || "").slice(0, 200),
                    cliente: (c[3] || "").slice(0, 200), tipo: c[5] || "", ciudad: loc });
      });
      if (!mios.length) {
        // distinguir «no hay» de «no pude leer»: sin esto, una cartelera vacía y
        // una sesión caída se veían iguales
        var filasTotales = doc.querySelectorAll("tr").length;
        nota(filasTotales < 3
          ? "La cartelera vino vacía: casi seguro se cerró la sesión. Reabrila y probá de nuevo."
          : "Leí " + filasTotales + " pedidos y ninguno es de la zona. Puede pasar a esta hora.",
          "warn");
        parar(); return;
      }
      nota("Hay " + mios.length + " pedidos de la zona. Voy a buscar qué piden…", "ok");

      // cabeceras primero: si algo se corta, al menos la lista queda
      await ingesta({ op: "indice", filas: mios.map(function (m) {
        return { id: m.id, cliente: m.cliente + " · " + m.ciudad, titulo: m.titulo, tipo: m.tipo,
                 vence: fechaCorta(m.vence), estado: "Abierta", renglones: 0 };
      })});

      for (var i = 0; i < mios.length; i++) {
        if (!ST.activo) break;
        var m = mios[i];
        try {
          var htmlDet = await traer("/jsp/vender/v_rpdc.jsp?nivel=1&id=" + m.id);
          if (esLogin(htmlDet)) throw new Error("SESION");
          var d = parseDetalle(htmlDet);
          await ingesta({ op: "detalle", id: m.id, renglones: d });
          ST.hechos++;
          nota("#" + m.id + " · " + d.length + " renglones · " + m.titulo.slice(0, 32), "ok");
        } catch (e) {
          if (String(e.message) === "SESION") throw e;
          // el motivo va SIEMPRE: un «no pude» a secas obliga a adivinar
          nota("No pude leer #" + m.id + ": " + String(e && e.message || e).slice(0, 70), "err");
        }
        await dormir(jitter(RITMO.pausa));
      }
      nota("Listo. Abrí «Plataformas → Abiertos» en el Core para verlos.", "ok");
    } catch (e) {
      if(String(e.message) === "SESION"){ nota("Se cerró la sesión de Bionexo.", "err"); reabrirSesion(); } else nota("Error: " + e.message, "err");
    }
    parar();
  }

  /* ============ LLENAR EL FORMULARIO ============
     Toma el paquete que arma el Core y completa precio, marca y presentación
     de cada renglón, tildando los que se cotizan. Los renglones que el Core no
     resolvió NO se tocan: quedan como estaban.

     LO QUE NO HACE, A PROPÓSITO: no aprieta enviar. Enviar una oferta es
     firmar un compromiso con un hospital — eso lo mira y lo decide una persona.

     Cada campo se llena disparando los eventos que la página espera (input y
     change): estos formularios viejos calculan totales al vuelo y si el valor
     se mete «a la fuerza» quedan mostrando una cosa y enviando otra. */
  function llenarFormulario(texto) {
    var t = String(texto || "").trim();
    var i = t.indexOf("BXQ1");
    if (i < 0) { nota("Eso no es lo que copia el Core. Volvé a «Cotizar pedido» y usá «Copiar para llenar en Bionexo».", "err"); return; }
    var paq;
    try { paq = JSON.parse(t.slice(i + 4)); } catch (e) { nota("El texto copiado está incompleto. Copialo de nuevo.", "err"); return; }

    var aqui = idPedido();
    if (paq.p && aqui && String(paq.p) !== String(aqui)) {
      if (!confirm("Ojo: esos precios se prepararon para el pedido " + paq.p + " y estás en el " + aqui + ".\n\n¿Los cargo igual?")) {
        nota("No llené nada. Abrí el pedido " + paq.p + " o preparalo de nuevo.", "err"); return;
      }
    }

    var puestos = 0, faltantes = [], n = 0;
    while (true) {
      n++;
      var cod = document.querySelector('input[name="codigo' + n + '"]');
      if (!cod) break;
      var datos = paq.r[String(cod.value).trim()];
      if (!datos) { faltantes.push(String(cod.value).trim()); continue; }
      poner('cotiz' + n, datos.pr);
      poner('marca' + n, datos.ma);
      poner('embalagem' + n, datos.em);
      var chk = document.querySelector('input[name="selec' + n + '"]');
      if (chk && chk.type === "checkbox" && !chk.checked) { chk.click(); }
      puestos++;
    }
    if (!puestos) { nota("No pude emparejar ningún renglón. ¿Es el pedido correcto?", "err"); return; }
    nota("Listos " + puestos + " renglones" + (faltantes.length ? " · " + faltantes.length + " quedaron vacíos (sin resolver)" : "") +
         ". REVISÁ en pantalla y enviá vos.", "ok");
  }

  function poner(nombre, valor) {
    var el = document.querySelector('[name="' + nombre + '"]');
    if (!el || valor == null || valor === "") return;
    el.value = valor;
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (e) {}
  }

  /* Se pide pegar a mano en vez de leer el portapapeles solo: leerlo pide un
     permiso que el navegador no siempre da, y fallar en silencio acá sería peor
     que un paso de más. */
  function pedirPaquete() {
    var caja = document.createElement("div");
    caja.style.cssText = "position:fixed;inset:0;background:rgba(6,65,62,.35);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px";
    caja.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:20px;max-width:460px;width:100%;font-family:system-ui,sans-serif">' +
        '<b style="font-size:15px;color:#0E1F1D">Pegá lo que copiaste del Core</b>' +
        '<p style="font-size:12.5px;color:#5F716E;line-height:1.5;margin:8px 0 10px">Hacé clic en el recuadro y apretá Ctrl+V.</p>' +
        '<textarea id="bx-paste" style="width:100%;height:110px;border:1px solid #DCE8E6;border-radius:9px;padding:10px;font-family:ui-monospace,monospace;font-size:11.5px" placeholder="BXQ1{...}"></textarea>' +
        '<div style="display:flex;gap:9px;margin-top:12px">' +
          '<button id="bx-ok" style="flex:1;background:#048782;color:#fff;border:0;border-radius:9px;padding:11px;font:inherit;font-weight:700;cursor:pointer">Llenar</button>' +
          '<button id="bx-no" style="background:#EEF2F1;color:#5F716E;border:0;border-radius:9px;padding:11px 16px;font:inherit;font-weight:700;cursor:pointer">Cancelar</button>' +
        "</div></div>";
    document.body.appendChild(caja);
    var ta = caja.querySelector("#bx-paste");
    ta.focus();
    caja.querySelector("#bx-no").onclick = function () { caja.remove(); };
    caja.querySelector("#bx-ok").onclick = function () { var v = ta.value; caja.remove(); llenarFormulario(v); };
  }

  function arrancar() {
    if (!EN_BIONEXO) {
      nota("Estás en " + location.hostname + ", no en Bionexo. Abrí bionexo-ar.bionexo.com, entrá con tu usuario y recién ahí tocá el favorito.", "err");
      return;
    }
    if (!KEY) { alert("Falta la clave. Rearmá el favorito desde el Core."); return; }
    ST.activo = true; pintar();
    ingesta({ op: "estado" })
      .then(function (e) {
        if (!e.cotizaciones) return leerIndice();
        nota("Ya hay " + e.cotizaciones + " cotizaciones guardadas, faltan " + e.faltan + " detalles");
      })
      .then(ciclo)
      .catch(function (err) {
        var m = String(err.message);
        nota(
          m === "SESION" ? (reabrirSesion(), "La sesión estaba cerrada. Te abrí el ingreso: entrá y volvé a tocar Empezar.")
          : m === "VACIO" ? "No pude leer ninguna cotización. Fijate que estés dentro de Bionexo y con la sesión abierta (probá entrar a Transacciones de Venta y ver si aparece el listado)."
          : ("Error: " + m), "err");
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
      (ST.activo ? "" :
        '<div style="padding:10px 14px 0"><button id="bx-zona" style="width:100%;background:#0AA89F;color:#fff;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:700;cursor:pointer">Traer pedidos de Santa Fe al Core</button>' +
        '<label style="display:flex;gap:7px;align-items:center;margin-top:9px;font-size:12px;color:#5F716E;cursor:pointer">' +
          '<input type="checkbox" id="bx-auto"' + (autoEncendido() ? " checked" : "") + ' style="width:15px;height:15px;accent-color:#048782">' +
          'Sincronizar solo cada ' + AUTO_MIN + ' min (dejando esta pestaña abierta)</label></div>') +
      '<div style="padding:10px 14px;display:flex;gap:8px">' + b +
        (/v_rpdc/.test(location.pathname)
          ? '<button id="bx-cot" style="flex:1;background:#fff;color:#04635F;border:1px solid #DCE8E6;border-radius:9px;padding:10px;font:inherit;font-weight:700;cursor:pointer">Copiar renglones</button>' +
            '<button id="bx-fill" style="flex:1;background:#04635F;color:#fff;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:700;cursor:pointer">Llenar formulario</button>'
          : "") +
      "</div>" +
      '<div style="padding:0 14px 12px;overflow:auto;flex:1">' +
        ST.log.map(function (l) {
          var c = l.tipo === "err" ? "#B0413E" : l.tipo === "ok" ? "#1E7D46" : l.tipo === "warn" ? "#B7791F" : "#5F716E";
          return '<div style="padding:5px 0;border-top:1px solid #F2F7F6;line-height:1.45;color:' + c + '">' +
            '<span style="color:#8A9A97;font-size:11px">' + l.t + "</span> " + l.txt + "</div>";
        }).join("") +
        (ST.log.length ? "" : (EN_BIONEXO
          ? '<div style="color:#8A9A97;padding:14px 0;line-height:1.5">Dale a Empezar. Podés seguir usando Bionexo mientras trabaja — va despacio a propósito.</div>'
          : '<div style="color:#B0413E;padding:14px 0;line-height:1.5"><b>Estás en ' + location.hostname + ', no en Bionexo.</b><br>Este botón se toca <b>estando dentro de bionexo-ar.bionexo.com</b>, con la sesión abierta. Abrí Bionexo en otra pestaña y tocalo ahí.</div>')) +
      "</div>";
    var g = document.getElementById("bx-go"), s = document.getElementById("bx-stop"), x = document.getElementById("bx-x");
    var cot = document.getElementById("bx-cot");
    if (cot) cot.onclick = copiarRenglones;
    var fill = document.getElementById("bx-fill");
    if (fill) fill.onclick = pedirPaquete;
    var zona = document.getElementById("bx-zona");
    if (zona) zona.onclick = traerAbiertos;
    var au = document.getElementById("bx-auto");
    if (au) au.onchange = function () { prenderAuto(au.checked); };
    if (g) g.onclick = arrancar;
    if (s) s.onclick = function () { nota("Frenado a mano. Lo leído está guardado."); parar(); };
    if (x) x.onclick = function () { parar(); caja.remove(); window.__BX_CORRIENDO = false; };
  }

  pintar();
  if (autoEncendido() && EN_BIONEXO) prenderAuto(true);   // quedó activado de antes
})();
