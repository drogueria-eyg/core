/* ===== EyG Core · Enviar / Imprimir un presupuesto (COMPARTIDO) =====
   Un panel con UNA acción protagonista (WhatsApp) + el cliente y el total a la
   vista, y las secundarias (PDF, copiar) chicas. Rediseñado 5/11/2026 para sacar
   la botonera de 4 botones iguales.

   Lo usan el Cotizador (modal "Presupuesto guardado"), Cargar venta (pantalla de
   venta y éxito) y las listas de presupuestos (Cargar venta y Panel).

   EL PDF ES EL FORMATO NATIVO DE ODOO (reporte "Cotización en PDF" /
   sale.report_saleorder): se abre por el portal con el access_token del pedido
   (NO hace falta estar logueado en Odoo) → imprime EXACTAMENTE el formato de
   Odoo, y nunca se desincroniza. No modifica nada: sólo read + get_portal_url.

   El estilo usa colores del Core en línea; la visual nueva (assets/v2.js) los
   traduce al tema y al modo oscuro sola (MutationObserver), así queda en armonía
   con cada pantalla sin CSS propio del tema.

   Uso:  EYGPP.abrir(orderId)
   Depende de window.EYG (rpc, money, esc). */
window.EYGPP = (function(){
  const E = window.EYG;
  const ES = {lang:"es_AR"};
  const esc = E.esc, money = E.money;
  let _baseUrl=null, _cur=null;

  /* ---------------- host + estilo del panel (propios) ---------------- */
  const CSS = `
  #eygpp-host .eygpp-scrim{position:fixed;inset:0;background:rgba(14,31,29,.48);display:flex;
    align-items:center;justify-content:center;z-index:99999;padding:16px}
  #eygpp-host .eygpp-card{background:#ffffff;border-radius:18px;width:100%;max-width:380px;
    padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.28);font-family:inherit;color:#0e1f1d;position:relative}
  #eygpp-host .eygpp-x{position:absolute;top:13px;right:13px;background:none;border:none;color:#9aa8a5;
    font-size:21px;line-height:1;cursor:pointer;padding:4px;border-radius:8px}
  #eygpp-host .eygpp-x:hover{background:#eef4f3;color:#5f716e}
  #eygpp-host .eygpp-hd{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  #eygpp-host .eygpp-ic{width:44px;height:44px;border-radius:12px;background:#e1f5ee;display:flex;
    align-items:center;justify-content:center;color:#0f6e56;font-size:21px;flex:none}
  #eygpp-host .eygpp-ht{font-size:16px;font-weight:600;color:#0e1f1d;line-height:1.2}
  #eygpp-host .eygpp-hs{font-size:12.5px;color:#5f716e;margin-top:1px}
  #eygpp-host .eygpp-sum{background:#f3f8f7;border:0.5px solid #d6e4e1;border-radius:12px;
    padding:11px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
  #eygpp-host .eygpp-lab{font-size:10.5px;color:#5f716e;text-transform:uppercase;letter-spacing:.4px}
  #eygpp-host .eygpp-cli{font-size:14px;font-weight:500;color:#0e1f1d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
  #eygpp-host .eygpp-tot{font-size:20px;font-weight:700;color:#04635f;line-height:1.1;white-space:nowrap}
  #eygpp-host .eygpp-wa{width:100%;background:#25a35a;color:#fff;border:none;border-radius:13px;padding:14px;
    font-size:15.5px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;
    justify-content:center;gap:9px;text-decoration:none;box-sizing:border-box;margin-bottom:10px}
  #eygpp-host .eygpp-row{display:flex;gap:10px}
  #eygpp-host .eygpp-sec{flex:1;background:#fff;color:#0f6e56;border:0.5px solid #cfe3dd;border-radius:11px;
    padding:11px;font-size:13.5px;font-weight:500;font-family:inherit;cursor:pointer;display:flex;
    align-items:center;justify-content:center;gap:7px;text-decoration:none;box-sizing:border-box}
  #eygpp-host .eygpp-sec:hover{background:#f3f8f7}
  #eygpp-host .eygpp-spin{width:30px;height:30px;border:3px solid #d6e4e1;border-top-color:#048782;
    border-radius:50%;animation:eygppSpin .8s linear infinite;margin:14px auto}
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
  const btnX = `<button class="eygpp-x" aria-label="Cerrar" onclick="EYGPP._cerrar()">✕</button>`;

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
    pintar(`${btnX}<div class="eygpp-hd"><div class="eygpp-ic">📤</div><div><div class="eygpp-ht">Enviar presupuesto</div><div class="eygpp-hs">Preparando…</div></div></div><div class="eygpp-spin"></div>`);
    try{
      const [o]=await E.rpc("sale.order","read",[[id],["name","partner_id","amount_total","state","order_line"]],{context:ES});
      if(!o) throw new Error("No encontré el presupuesto.");
      const rel=await E.rpc("sale.order","get_portal_url",[[id]]);
      const base=await baseUrl();
      const portalUrl=base+rel;
      const pdfUrl=base+rel+(rel.indexOf("?")>=0?"&":"?")+"report_type=pdf";
      const esPedido=(o.state==="sale"||o.state==="done");
      const nombre=o.name||(esPedido?"pedido":"presupuesto");
      const cli=(o.partner_id&&o.partner_id[1])||"";
      const nprod=(o.order_line||[]).length;
      _cur={portalUrl};
      const msg=`Hola! Te comparto el ${esPedido?"pedido":"presupuesto"} ${nombre} de Droguería EyG para que lo veas completo:\n${portalUrl}`;
      const wa="https://api.whatsapp.com/send?text="+encodeURIComponent(msg);
      pintar(`${btnX}
        <div class="eygpp-hd">
          <div class="eygpp-ic">📤</div>
          <div><div class="eygpp-ht">${esPedido?"Enviar pedido":"Enviar presupuesto"}</div>
            <div class="eygpp-hs">Nº ${esc(nombre)}${nprod?` · ${nprod} producto${nprod===1?"":"s"}`:""}</div></div>
        </div>
        ${cli?`<div class="eygpp-sum">
          <div style="min-width:0"><div class="eygpp-lab">Cliente</div><div class="eygpp-cli">${esc(cli)}</div></div>
          <div style="text-align:right;flex:none"><div class="eygpp-lab">Total</div><div class="eygpp-tot">${money(o.amount_total)}</div></div>
        </div>`:""}
        <a class="eygpp-wa" href="${wa}" target="_blank" rel="noopener" onclick="EYGPP._cerrar()">🟢 Enviar por WhatsApp</a>
        <div class="eygpp-row">
          <a class="eygpp-sec" href="${pdfUrl}" target="_blank" rel="noopener">📄 Ver PDF</a>
          <button class="eygpp-sec" onclick="EYGPP._copiar()">🔗 Copiar enlace</button>
        </div>`);
    }catch(e){
      pintar(`${btnX}<div class="eygpp-hd"><div class="eygpp-ic">📤</div><div class="eygpp-ht">Enviar presupuesto</div></div>
        <div class="eygpp-err">No pude prepararlo: ${esc(e&&e.message?e.message:String(e))}</div>`);
    }
  }
  function _copiar(){
    const url=_cur&&_cur.portalUrl; if(!url) return;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(()=>toast("Enlace copiado ✓")).catch(()=>toast("No pude copiar"));
    } else toast("No pude copiar");
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
