/* ===== EyG Core · SUPEROFERTAS A ASENTAR (Cobranzas) — 16/11/2026 =====
   Pedidos de Superofertas de contado que esperan que Cobranzas asiente el cobro:
   - por transferencia: la comercial "Avisa el pago" (etiqueta PAGO INFORMADO, con el comprobante adjunto si lo
     subió); Bárbara verifica en Mercado Pago y toca "Asentar y liberar";
   - en efectivo (proforma): el repartidor trae la plata; se toca "Asentar efectivo".
   El botón corre la acción de Odoo 1336 "💵 Superoferta: asentar cobro y liberar" (la misma que Cobranzas tiene
   en Odoo, menú Acción): crea el recibo RE-X (Mercado Pago / Efectivo B), lo imputa a la factura si ya
   existe (si no, se imputa solo al facturar), pone PAGADO y libera la entrega para que Martina la arme. */
window.EYGSuperCobro = (function(){
  "use strict";
  const ACCION=1336, ODOO="https://drogueriaeyg.odoo.com";
  const rpc=(m,me,a,k)=>EYG.rpc(m,me,a,k||{});
  const esc=s=>EYG.esc(s);
  const money=n=>"$ "+Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
  let EL=null, PERFIL=null, T={esp:0,pag:0,efe:0,inf:0}, PED=[], ADJ={}, MSG="", OCUP=false;
  const puede=()=>PERFIL && ["finanzas","cobranzas","admin","direccion"].includes(PERFIL.rol);
  function css(){
    if(document.getElementById("eyg-sc-css")) return;
    const s=document.createElement("style"); s.id="eyg-sc-css";
    s.textContent=`.sc{border:1.5px solid #8DB600;background:#F8FBEE;border-radius:14px;padding:14px 16px;margin:0 0 16px}
.sc h3{margin:0 0 4px;font-size:17px;color:#0F3D33}.sc .sub{font-size:12.5px;color:#5C6B64;margin:0 0 10px}
.sc table{width:100%;border-collapse:collapse;font-size:13px}.sc th{text-align:left;font-size:11.5px;color:#5C6B64;font-weight:600;padding:6px 8px;border-bottom:1px solid #DCE4DE}
.sc td{padding:8px;border-bottom:1px solid #E7EEE9;vertical-align:middle}.sc td.n{text-align:right;white-space:nowrap}
.sc .chip{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap}
.sc .c-esp{background:#F5E4DD;color:#A6453A}.sc .c-inf{background:#FFF1C9;color:#7A5500}.sc .c-efe{background:#E3EEDD;color:#2E7A4E}
.sc button.as{border:0;border-radius:8px;padding:7px 12px;font-weight:800;cursor:pointer;background:#0F3D33;color:#D7F75B;white-space:nowrap}
.sc button.as[disabled]{opacity:.5;cursor:default}.sc .msg{white-space:pre-wrap;font-size:13px;margin:8px 0 0;padding:8px 10px;border-radius:8px;background:#fff;border:1px solid #DCE4DE}
.sc a{color:#0F6E56}.sc .vacio{font-size:13px;color:#5C6B64;padding:4px 0}
.sc-modal{position:fixed;inset:0;z-index:3000;background:rgba(10,30,26,.5);display:flex;align-items:center;justify-content:center;padding:16px}
.sc-modal .bx{background:#fff;border-radius:14px;max-width:460px;width:100%;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
.sc-modal h4{margin:0 0 8px;font-size:17px;color:#0F3D33}.sc-modal p{font-size:13.5px;line-height:1.5;margin:0 0 10px}
.sc-modal .bt{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.sc-modal button{border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;border:1px solid #CBD5CF;background:#fff}
.sc-modal button.si{background:#0F3D33;color:#D7F75B;border-color:#0F3D33}`;
    document.head.appendChild(s);
  }
  async function cargar(){
    PED=[]; ADJ={};
    try{
      const t=String(await rpc("ir.config_parameter","get_param",["eyg.ofertas_contado_tags"])||"").split(",").map(x=>parseInt(x,10)||0);
      T={esp:t[0]||0,pag:t[1]||0,efe:t[2]||0,inf:t[3]||0}; if(!T.esp) return;
      const desde=new Date(Date.now()-90*864e5).toISOString().slice(0,10);
      PED=(await rpc("sale.order","search_read",[[["tag_ids","in",[T.esp,T.efe,T.inf].filter(Boolean)],["state","in",["sale","sent"]],["date_order",">=",desde]]],
        {fields:["id","name","partner_id","user_id","amount_total","state","date_order","tag_ids"],order:"date_order asc",limit:200}))||[];
      PED=PED.filter(p=>!p.tag_ids.includes(T.pag));
      if(PED.length){
        const ad=await rpc("ir.attachment","search_read",[[["res_model","=","sale.order"],["res_id","in",PED.map(p=>p.id)],["name","ilike","comprobante"]]],{fields:["id","name","res_id"],limit:400});
        (ad||[]).forEach(a=>{ (ADJ[a.res_id]=ADJ[a.res_id]||[]).push(a); });
      }
    }catch(e){ MSG="No pude leer los pedidos de superofertas: "+String(e.message||e).slice(0,200); }
  }
  const tipo=p=>(T.efe&&p.tag_ids.includes(T.efe))?"efe":(T.inf&&p.tag_ids.includes(T.inf))?"inf":"esp";
  function html(){
    if(!T.esp && !MSG) return "";
    const orden={inf:0,efe:1,esp:2};
    const ls=PED.slice().sort((a,b)=>orden[tipo(a)]-orden[tipo(b)]);
    const chip=p=>({inf:'<span class="chip c-inf">PAGO INFORMADO · verificar y asentar</span>',
      efe:'<span class="chip c-efe">EFECTIVO · a cobrar en la entrega</span>',
      esp:'<span class="chip c-esp">ESPERANDO PAGO · '+(p.state==="sale"?"entrega trabada":"sin confirmar")+'</span>'})[tipo(p)];
    const filas=ls.map(p=>{
      const f=String(p.date_order||"").slice(0,10).split("-").reverse().join("/");
      const adj=(ADJ[p.id]||[]).map(a=>`<a href="${ODOO}/web/content/${a.id}?download=true" target="_blank" rel="noopener">📎 comprobante</a>`).join(" ");
      const ef=tipo(p)==="efe";
      return `<tr><td><b>${esc(p.name)}</b><div style="font-size:11.5px;color:#5C6B64">${f} · <a href="${ODOO}/web#id=${p.id}&model=sale.order&view_type=form" target="_blank" rel="noopener">Odoo ↗</a></div></td>
        <td>${esc(p.partner_id?p.partner_id[1]:"")}<div style="font-size:11.5px;color:#5C6B64">${esc(p.user_id?p.user_id[1]:"sin comercial")}</div></td>
        <td class="n"><b>${money(p.amount_total)}</b></td>
        <td>${chip(p)}${adj?"<div style=\"margin-top:3px\">"+adj+"</div>":""}</td>
        <td class="n">${puede()?`<button class="as" ${OCUP?"disabled":""} onclick="EYGSuperCobro.pedir(${p.id})">${ef?"Asentar efectivo":"Asentar y liberar"}</button>`:""}</td></tr>`;
    }).join("");
    return `<div class="sc">
      <h3>💵 Superofertas a asentar <span style="font-weight:400;font-size:13px;color:#5C6B64">(${ls.length})</span></h3>
      <div class="sub">Transferencias a <b>Mercado Pago</b> (alias eyg.mpago): verificá la acreditación y tocá <b>Asentar y liberar</b> — se crea el recibo RE-X, se imputa a la factura (o queda a cuenta y se imputa sola al facturar) y se libera la entrega. Efectivo (proforma): cuando el repartidor trae la plata, <b>Asentar efectivo</b> (Efectivo B).</div>
      ${ls.length?`<div style="overflow-x:auto"><table><thead><tr><th>Pedido</th><th>Cliente · comercial</th><th class="n">Total</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`:'<div class="vacio">No hay superofertas pendientes de asentar.</div>'}
      ${MSG?`<div class="msg">${esc(MSG)}</div>`:""}
    </div>`;
  }
  function pintar(){ if(EL) EL.innerHTML=html(); }
  function cerrar(){ const m=document.getElementById("sc-modal"); if(m) m.remove(); }
  function pedir(id){
    const p=PED.find(x=>x.id===id); if(!p||OCUP) return;
    const ef=tipo(p)==="efe";
    cerrar();
    const d=document.createElement("div"); d.className="sc-modal"; d.id="sc-modal";
    d.innerHTML=`<div class="bx"><h4>${ef?"Asentar cobro en efectivo":"Asentar cobro y liberar"}</h4>
      <p><b>${esc(p.name)}</b> · ${esc(p.partner_id?p.partner_id[1]:"")} · <b>${money(p.amount_total)}</b></p>
      <p>${ef?"Se crea el recibo RE-X en <b>Efectivo B</b> por el total. Confirmalo sólo si la plata ya está en Cobranzas."
             :"Se crea el recibo RE-X en <b>Mercado Pago</b> por el total y se libera la entrega para que el depósito lo arme. Confirmalo sólo si ya viste la transferencia acreditada."}</p>
      <div class="bt"><button onclick="EYGSuperCobro.cerrar()">Cancelar</button><button class="si" onclick="EYGSuperCobro.asentar(${p.id})">${ef?"Sí, asentar":"Sí, asentar y liberar"}</button></div></div>`;
    d.addEventListener("click",e=>{ if(e.target===d) cerrar(); });
    document.body.appendChild(d);
  }
  async function asentar(id){
    cerrar(); const p=PED.find(x=>x.id===id); if(!p||OCUP) return;
    OCUP=true; MSG="Asentando "+p.name+"…"; pintar();
    try{
      const quien=(PERFIL&&PERFIL.nombre)||"el Core";
      await rpc("ir.actions.server","run",[[ACCION]],{context:{active_model:"sale.order",active_id:id,active_ids:[id],eyg_quien:quien}});
      const pg=await rpc("account.payment","search_read",[[["ref","=","Superoferta "+p.name],["state","=","posted"]]],{fields:["name","journal_id"],limit:1});
      MSG="✓ "+p.name+": recibo "+(pg[0]?pg[0].name+" ("+pg[0].journal_id[1]+")":"creado")+(tipo(p)==="efe"?".":". Entrega liberada.");
    }catch(e){ MSG="No se pudo asentar "+p.name+": "+String(e.message||e).slice(0,300); }
    await cargar(); OCUP=false; pintar();
  }
  async function montar(el, perfil){ EL=el; PERFIL=perfil; if(!EL) return; css(); await cargar(); pintar(); }
  return { montar, pedir, asentar, cerrar, recargar:async()=>{ await cargar(); pintar(); } };
})();
