/* ===== EyG Core · Enviar / Imprimir un presupuesto (COMPARTIDO) =====
   Un solo panelito, igual en todos lados: 🟢 WhatsApp (link del portal) ·
   📋 Copiar enlace · 📄 Ver / Imprimir PDF.

   Lo usan el Cotizador (modal "Presupuesto guardado"), Cargar venta (pantalla
   de venta y éxito) y las listas de presupuestos (Cargar venta y Panel). Antes
   de esto no había forma de enviar/imprimir el presupuesto en el flujo: había
   que ir a la sección de presupuestos.

   EL PDF ES EL FORMATO NATIVO DE ODOO (reporte "Cotización en PDF" /
   sale.report_saleorder): se abre por el portal con el access_token del pedido
   (NO hace falta estar logueado en Odoo). Así imprime EXACTAMENTE el formato de
   presupuesto definido en Odoo — con logo, "Presupuesto", fotos de producto,
   vencimiento, términos de pago e IVA — y nunca se desincroniza de Odoo.
   No modifica nada: sólo read + get_portal_url.

   El estilo usa colores del Core en línea; la visual nueva (assets/v2.js) los
   traduce al tema y al modo oscuro sola (tiene MutationObserver), así el panel
   queda en armonía con cada pantalla sin CSS propio del tema.

   Uso:  EYGPP.abrir(orderId)           // abre el panel para ese presupuesto
   Depende de window.EYG (rpc, money, esc). */
window.EYGPP = (function(){
  const E = window.EYG;
  const ES = {lang:"es_AR"};
  const esc = E.esc, money = E.money;
  let _baseUrl=null, _cur=null;

  /* ---------------- host + estilo del modal (propios) ---------------- */
  const CSS = `
  #eygpp-host .eygpp-scrim{position:fixed;inset:0;background:rgba(14,31,29,.48);display:flex;
    align-items:center;justify-content:center;z-index:99999;padding:16px}
  #eygpp-host .eygpp-card{background:#ffffff;border-radius:16px;width:100%;max-width:440px;
    padding:22px 22px 20px;box-shadow:0 24px 70px rgba(0,0,0,.28);font-family:inherit;color:#0e1f1d}
  #eygpp-host .eygpp-card h3{margin:0 0 6px;font-size:18px;color:#0e1f1d}
  #eygpp-host .eygpp-sub{font-size:13.5px;color:#5f716e;margin:0 0 16px;line-height:1.45}
  #eygpp-host .eygpp-btns{display:flex;flex-direction:column;gap:10px}
  #eygpp-host .eygpp-b{display:flex;align-items:center;justify-content:center;gap:8px;
    border:none;border-radius:12px;padding:13px 16px;font-size:15px;font-weight:700;cursor:pointer;
    text-decoration:none;font-family:inherit;line-height:1.1;width:100%;box-sizing:border-box}
  #eygpp-host .eygpp-b.wa{background:#25a35a;color:#ffffff}
  #eygpp-host .eygpp-b.teal{background:#048782;color:#ffffff}
  #eygpp-host .eygpp-b.ghost{background:transparent;color:#0e1f1d;border:1px solid #d6e4e1;font-weight:600}
  #eygpp-host .eygpp-b:disabled{opacity:.6;cursor:default}
  #eygpp-host .eygpp-link{word-break:break-all;background:#f3f8f7;border:1px solid #d6e4e1;
    border-radius:10px;padding:10px;font-size:12px;color:#5f716e;margin:14px 0 0}
  #eygpp-host .eygpp-spin{width:30px;height:30px;border:3px solid #d6e4e1;border-top-color:#048782;
    border-radius:50%;animation:eygppSpin .8s linear infinite;margin:6px auto}
  @keyframes eygppSpin{to{transform:rotate(360deg)}}
  #eygpp-host .eygpp-err{background:#fbe4e3;border:1px solid #f3b5b2;color:#8a2e2b;
    border-radius:10px;padding:10px;font-size:13px;margin:4px 0 0}`;

  function host(){
    let h=document.getElementById("eygpp-host");
    if(!h){
      h=document.createElement("div"); h.id="eygpp-host";
      const st=document.createElement("style"); st.id="eygpp-css"; st.textContent=CSS;
      document.head.appendChild(st); document.body.appendChild(h);
    }
    return h;
  }
  function pintar(html){ host().innerHTML=`<div class="eygpp-scrim" onclick="if(event.target===this)EYGPP._cerrar()"><div class="eygpp-card">${html}</div></div>`; }
  function cerrar(){ const h=document.getElementById("eygpp-host"); if(h) h.innerHTML=""; }

  /* ---------------- datos de Odoo ---------------- */
  async function baseUrl(){
    if(_baseUrl) return _baseUrl;
    try{ _baseUrl=(await E.rpc("ir.config_parameter","get_param",["web.base.url"]))||"https://drogueriaeyg.odoo.com"; }
    catch(e){ _baseUrl="https://drogueriaeyg.odoo.com"; }
    return _baseUrl;
  }

  /* ---------------- panel ---------------- */
  async function abrir(id){
    if(!id) return;
    pintar(`<h3>📤 Enviar / Imprimir</h3><div class="eygpp-spin"></div><p class="eygpp-sub" style="text-align:center">Preparando el presupuesto…</p>`);
    try{
      const [o]=await E.rpc("sale.order","read",[[id],["name","partner_id","amount_total","state"]],{context:ES});
      if(!o) throw new Error("No encontré el presupuesto.");
      const rel=await E.rpc("sale.order","get_portal_url",[[id]]);
      const base=await baseUrl();
      const portalUrl=base+rel;
      // PDF = formato nativo de Odoo, abierto por el portal con el access_token (sin login)
      const pdfUrl=base+rel+(rel.indexOf("?")>=0?"&":"?")+"report_type=pdf";
      const esPedido=(o.state==="sale"||o.state==="done");
      const nombre=o.name||(esPedido?"pedido":"presupuesto");
      const cli=(o.partner_id&&o.partner_id[1])||"";
      _cur={portalUrl};
      const msg=`Hola! Te comparto el ${esPedido?"pedido":"presupuesto"} ${nombre} de Droguería EyG para que lo veas completo:\n${portalUrl}`;
      const wa="https://api.whatsapp.com/send?text="+encodeURIComponent(msg);
      pintar(`<h3>📤 Enviar / Imprimir</h3>
        <p class="eygpp-sub">${esPedido?"Pedido":"Presupuesto"} <b>${esc(nombre)}</b>${cli?` de <b>${esc(cli)}</b>`:""} · Total <b>${money(o.amount_total)}</b>.<br>
          El enlace lo abre completo, sin entrar a Odoo. El PDF es el formato de EyG, listo para imprimir o adjuntar.</p>
        <div class="eygpp-btns">
          <a class="eygpp-b wa" href="${wa}" target="_blank" rel="noopener" onclick="EYGPP._cerrar()">🟢 Enviar por WhatsApp</a>
          <button class="eygpp-b teal" onclick="EYGPP._copiar()">📋 Copiar enlace</button>
          <a class="eygpp-b teal" href="${pdfUrl}" target="_blank" rel="noopener">📄 Ver / Imprimir PDF</a>
          <button class="eygpp-b ghost" onclick="EYGPP._cerrar()">Cerrar</button>
        </div>
        <div class="eygpp-link">${esc(portalUrl)}</div>`);
    }catch(e){
      pintar(`<h3>📤 Enviar / Imprimir</h3>
        <div class="eygpp-err">No pude preparar el presupuesto: ${esc(e&&e.message?e.message:String(e))}</div>
        <div class="eygpp-btns" style="margin-top:12px"><button class="eygpp-b ghost" onclick="EYGPP._cerrar()">Cerrar</button></div>`);
    }
  }
  function _copiar(){
    const url=_cur&&_cur.portalUrl; if(!url) return;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(()=>toast("Enlace copiado ✓")).catch(()=>toast("Copiá el enlace de abajo"));
    } else toast("Copiá el enlace de abajo");
  }
  /* toast propio (no todas las páginas exponen uno global con el mismo nombre) */
  function toast(txt){
    let t=document.getElementById("eygpp-toast");
    if(!t){ t=document.createElement("div"); t.id="eygpp-toast";
      t.style.cssText="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#0e1f1d;color:#fff;"+
        "padding:11px 18px;border-radius:12px;font-size:14px;z-index:100000;box-shadow:0 10px 30px rgba(0,0,0,.3);"+
        "font-family:inherit;max-width:90vw;text-align:center;opacity:0;transition:opacity .2s";
      document.body.appendChild(t); }
    t.textContent=txt; requestAnimationFrame(()=>{ t.style.opacity="1"; });
    clearTimeout(t._h); t._h=setTimeout(()=>{ t.style.opacity="0"; }, 2600);
  }

  return { abrir, _copiar, _cerrar:cerrar };
})();
