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
  let EL=null, PERFIL=null, T={esp:0,pag:0,efe:0,inf:0,dif:0}, PED=[], DIFS=[], ADJ={}, MSG="", OCUP=false;
  /* Cruce con Mercado Pago (17/11/2026): la función mp-transferencias lee los cobros que entran a la cuenta
     (sólo lectura). Mercado Pago no dice quién transfirió, así que se cruza por IMPORTE (±$1: hay clientes
     que redondean) y por fecha (desde dos días antes del pedido). Cada transferencia se usa una sola vez: al
     asentar queda en el recibo como "MP <operación>" (Referencia de pago) y ya no se ofrece. */
  const MP_URL="https://yxotopoklgjowcudveoj.supabase.co/functions/v1/mp-transferencias";
  let MP=[], MPERR="", USADOS=new Set();
  const fmtFH=d=>{ try{ return new Date(d).toLocaleString("es-AR",{timeZone:"America/Argentina/Buenos_Aires",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }catch(e){ return String(d||"").slice(0,16); } };
  async function leerMP(){
    MP=[]; MPERR=""; USADOS=new Set();
    try{
      const ses=await EYG.supa().auth.getSession(); const tok=ses&&ses.data&&ses.data.session&&ses.data.session.access_token;
      const h={"Content-Type":"application/json"}; if(tok) h.Authorization="Bearer "+tok;
      const r=await fetch(MP_URL,{method:"POST",headers:h,body:JSON.stringify({dias:20})});
      const j=await r.json();
      if(!j.ok) throw new Error(j.error||("HTTP "+r.status));
      MP=(j.cobros||[]).filter(c=>c.estado==="approved");
      const desde=new Date(Date.now()-60*864e5).toISOString().slice(0,10);
      const us=await rpc("account.payment","search_read",[[["payment_reference","=like","MP %"],["date",">=",desde]]],{fields:["payment_reference"],limit:500});
      (us||[]).forEach(u=>USADOS.add(String(u.payment_reference||"").replace(/^MP\s+/,"")));
    }catch(e){ MPERR=String(e.message||e).slice(0,160); }
  }
  const libres=()=>MP.filter(t=>!USADOS.has(String(t.id)));
  const coincide=(t,p)=>Math.abs(Number(t.importe)-Number(p.amount_total))<=1.0 && new Date(t.fecha_aprobado||t.fecha_creado).getTime() >= new Date(String(p.date_order||"").replace(" ","T")+"Z").getTime()-2*864e5;
  function cruce(p){
    if(tipo(p)==="efe") return null;
    const cands=libres().filter(t=>coincide(t,p));
    if(!cands.length) return {n:0};
    if(cands.length===1){ const otros=PED.filter(q=>q.id!==p.id && tipo(q)!=="efe" && coincide(cands[0],q)).length; return {n:1, t:cands[0], unico:!otros}; }
    return {n:cands.length};
  }
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
.sc a{color:#0F6E56}.sc .scdif{margin-top:12px;border-top:1px dashed #E3C9A0;padding-top:10px}.sc .scdif h4{margin:0 0 4px;font-size:14.5px;color:#8A5A00}.sc .dfila{font-size:13px;padding:5px 0;border-bottom:1px dashed #EFE3CF}.sc button.as.sm{padding:4px 9px;font-size:12px;margin-left:6px}.sc .mpok{margin-top:4px;font-size:12px;color:#1F6B3A;font-weight:700}.sc .mpdu{margin-top:4px;font-size:12px;color:#8A5A00;font-weight:700}.sc .mpno{margin-top:4px;font-size:11.5px;color:#8A9690}
.sc details.mpsin{margin-top:10px;font-size:13px}.sc details.mpsin summary{cursor:pointer;font-weight:700;color:#0F3D33}.sc .mpfila{padding:3px 0;border-bottom:1px dashed #E1E8E3}.sc .vacio{font-size:13px;color:#5C6B64;padding:4px 0}
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
      T={esp:t[0]||0,pag:t[1]||0,efe:t[2]||0,inf:t[3]||0,dif:t[4]||0}; if(!T.esp) return;
      const desde=new Date(Date.now()-90*864e5).toISOString().slice(0,10);
      PED=(await rpc("sale.order","search_read",[[["tag_ids","in",[T.esp,T.efe,T.inf].filter(Boolean)],["state","in",["sale","sent"]],["date_order",">=",desde]]],
        {fields:["id","name","partner_id","user_id","amount_total","state","date_order","tag_ids"],order:"date_order asc",limit:200}))||[];
      PED=PED.filter(p=>!p.tag_ids.includes(T.pag));
      if(PED.length){
        const ad=await rpc("ir.attachment","search_read",[[["res_model","=","sale.order"],["res_id","in",PED.map(p=>p.id)],["name","ilike","comprobante"]]],{fields:["id","name","res_id"],limit:400});
        (ad||[]).forEach(a=>{ (ADJ[a.res_id]=ADJ[a.res_id]||[]).push(a); });
      }
    }catch(e){ MSG="No pude leer los pedidos de superofertas: "+String(e.message||e).slice(0,200); }
    await leerMP();
    // pedidos ya cobrados cuya factura no dio igual a lo pagado (más que un redondeo): los marca Odoo al facturar
    DIFS=[];
    try{
      if(T.dif) DIFS=(await rpc("sale.order","search_read",[[["tag_ids","in",[T.dif]],["state","in",["sale","done"]]]],
        {fields:["id","name","partner_id","user_id","amount_total","date_order"],order:"date_order desc",limit:100}))||[];
    }catch(e){}
  }
  function difsHTML(){
    if(!DIFS.length) return "";
    return '<div class="scdif"><h4>⚠ Diferencias al facturar ('+DIFS.length+')</h4>'+
      '<div class="sub">Superofertas cobradas cuya factura no dio igual a lo pagado (por ejemplo, porque no se entregó todo). No se ajustan solas: el detalle (saldo a favor o falta cobrar) está en la nota del pedido. Decidí si se aplica al próximo pedido, se devuelve o se cobra, y marcalo como resuelto.</div>'+
      DIFS.map(p=>'<div class="dfila"><b>'+esc(p.name)+'</b> · '+esc(p.partner_id?p.partner_id[1]:"")+' · '+esc(p.user_id?p.user_id[1]:"")+' · <a href="'+ODOO+'/web#id='+p.id+'&model=sale.order&view_type=form" target="_blank" rel="noopener">ver la nota en Odoo ↗</a>'+
        (puede()?' <button class="as sm" '+(OCUP?"disabled":"")+' onclick="EYGSuperCobro.resuelto('+p.id+')">Ya está resuelto</button>':'')+'</div>').join("")+'</div>';
  }
  async function resuelto(id){
    const p=DIFS.find(x=>x.id===id); if(!p||OCUP) return;
    if(!confirm("¿Marcar resuelta la diferencia del pedido "+p.name+"? Se saca el aviso (la imputación en Odoo la hacés vos).")) return;
    OCUP=true;
    try{
      await rpc("sale.order","write",[[id],{tag_ids:[[3,T.dif]]}]);
      await rpc("sale.order","message_post",[[id]],{body:"Superofertas de contado: diferencia al facturar marcada como resuelta por "+((PERFIL&&PERFIL.nombre)||"Cobranzas")+".",message_type:"comment",subtype_xmlid:"mail.mt_note"}).catch(()=>{});
      MSG="Diferencia de "+p.name+" marcada como resuelta.";
    }catch(e){ MSG="No pude marcarla: "+String(e.message||e).slice(0,200); }
    await cargar(); OCUP=false; pintar();
  }
  const tipo=p=>(T.efe&&p.tag_ids.includes(T.efe))?"efe":(T.inf&&p.tag_ids.includes(T.inf))?"inf":"esp";
  function mpHTML(p){
    if(MPERR || tipo(p)==="efe") return "";
    const c=cruce(p); if(!c) return "";
    if(c.n===1 && c.unico) return '<div class="mpok">✓ Acreditado en Mercado Pago: <b>'+money(c.t.importe)+'</b> · '+fmtFH(c.t.fecha_aprobado)+' · op. '+esc(String(c.t.id))+'</div>';
    if(c.n>=1) return '<div class="mpdu">⚠ '+(c.n>1?'Hay '+c.n+' transferencias de ese importe':'La transferencia de ese importe también coincide con otro pedido')+': verificá en Mercado Pago</div>';
    return '<div class="mpno">Sin transferencia de ese importe en Mercado Pago (últimos 20 días)</div>';
  }
  function sinAsignarHTML(){
    if(MPERR) return '<div class="vacio">No pude leer Mercado Pago: '+esc(MPERR)+'</div>';
    const asign=new Set(); PED.forEach(p=>{ const c=cruce(p); if(c&&c.t) asign.add(c.t.id); });
    const ls=libres().filter(t=>!asign.has(t.id) && (Date.now()-new Date(t.fecha_aprobado).getTime())<7*864e5);
    if(!ls.length) return "";
    return '<details class="mpsin"><summary>Cobros de Mercado Pago de los últimos 7 días sin pedido de superofertas ('+ls.length+')</summary>'+
      '<div style="font-size:12.5px;color:#5C6B64;margin:4px 0">Pueden ser superofertas pagadas con otro importe, o cobros que no son superofertas. Mercado Pago no informa quién transfirió.</div>'+
      ls.slice(0,15).map(t=>'<div class="mpfila">'+fmtFH(t.fecha_aprobado)+' · <b>'+money(t.importe)+'</b> · op. '+esc(String(t.id))+(t.descripcion&&t.descripcion!=="Varios"?' · '+esc(t.descripcion):'')+'</div>').join("")+'</details>';
  }
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
        <td>${chip(p)}${adj?"<div style=\"margin-top:3px\">"+adj+"</div>":""}${mpHTML(p)}</td>
        <td class="n">${puede()?`<button class="as" ${OCUP?"disabled":""} onclick="EYGSuperCobro.pedir(${p.id})">${ef?"Asentar efectivo":"Asentar y liberar"}</button>`:""}</td></tr>`;
    }).join("");
    return `<div class="sc">
      <h3>💵 Superofertas a asentar <span style="font-weight:400;font-size:13px;color:#5C6B64">(${ls.length})</span></h3>
      <div class="sub">Transferencias a <b>Mercado Pago</b> (alias eyg.mpago): verificá la acreditación y tocá <b>Asentar y liberar</b> — se crea el recibo RE-X, se imputa a la factura (o queda a cuenta y se imputa sola al facturar) y se libera la entrega. Efectivo (proforma): cuando el repartidor trae la plata, <b>Asentar efectivo</b> (Efectivo B).<br><b>Cruce automático:</b> cada 5 minutos el sistema lee Mercado Pago y, si una transferencia coincide sin dudas con un solo pedido, lo asienta y libera solo (queda firmado \"Mercado Pago (cruce automático)\"). Acá quedan los que no se pudieron cruzar solos.</div>
      ${ls.length?`<div style="overflow-x:auto"><table><thead><tr><th>Pedido</th><th>Cliente · comercial</th><th class="n">Total</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`:'<div class="vacio">No hay superofertas pendientes de asentar.</div>'}
      ${difsHTML()}
      ${sinAsignarHTML()}
      ${MSG?`<div class="msg">${esc(MSG)}</div>`:""}
    </div>`;
  }
  function pintar(){ if(EL) EL.innerHTML=html(); }
  function cerrar(){ const m=document.getElementById("sc-modal"); if(m) m.remove(); }
  function mpModal(p){
    const c=cruce(p);
    if(c&&c.n===1&&c.unico) return '<p style="background:#EEF6E8;border-radius:8px;padding:8px 10px">✓ Transferencia de Mercado Pago: <b>'+money(c.t.importe)+'</b> el '+fmtFH(c.t.fecha_aprobado)+' (operación '+esc(String(c.t.id))+'). Queda anotada en el recibo.</p>';
    if(tipo(p)!=="efe") return '<p style="background:#FFF6E0;border-radius:8px;padding:8px 10px">No hay una transferencia de Mercado Pago que coincida sola con este pedido: verificala a mano antes de asentar.</p>';
    return "";
  }
  function pedir(id){
    const p=PED.find(x=>x.id===id); if(!p||OCUP) return;
    const ef=tipo(p)==="efe";
    cerrar();
    const d=document.createElement("div"); d.className="sc-modal"; d.id="sc-modal";
    d.innerHTML=`<div class="bx"><h4>${ef?"Asentar cobro en efectivo":"Asentar cobro y liberar"}</h4>
      <p><b>${esc(p.name)}</b> · ${esc(p.partner_id?p.partner_id[1]:"")} · <b>${money(p.amount_total)}</b></p>
      ${mpModal(p)}
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
      const c=cruce(p); const ctx={active_model:"sale.order",active_id:id,active_ids:[id],eyg_quien:quien};
      if(c&&c.n===1&&c.unico){ ctx.eyg_mp_id=String(c.t.id); ctx.eyg_mp_importe=Number(c.t.importe); if(c.t.neto!=null) ctx.eyg_mp_neto=Number(c.t.neto); ctx.eyg_mp_fecha=c.t.fecha_aprobado||c.t.fecha_creado; }   // recibo por lo transferido; comisión a gastos
      await rpc("ir.actions.server","run",[[ACCION]],{context:ctx});
      const pg=await rpc("account.payment","search_read",[[["ref","=","Superoferta "+p.name],["state","=","posted"]]],{fields:["name","journal_id"],limit:1});
      MSG="✓ "+p.name+": recibo "+(pg[0]?pg[0].name+" ("+pg[0].journal_id[1]+")":"creado")+(tipo(p)==="efe"?".":". Entrega liberada.");
    }catch(e){ MSG="No se pudo asentar "+p.name+": "+String(e.message||e).slice(0,300); }
    await cargar(); OCUP=false; pintar();
  }
  async function montar(el, perfil){ EL=el; PERFIL=perfil; if(!EL) return; css(); await cargar(); pintar(); }
  return { montar, pedir, asentar, cerrar, resuelto, recargar:async()=>{ await cargar(); pintar(); } };
})();
