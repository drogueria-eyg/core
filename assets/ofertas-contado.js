/* ===== EyG Core · Oportunidades y Ofertas · OFERTAS DE CONTADO (farmacias) =====
   Sección aparte para la liquidación de contado (16/11/2026). Las ofertas viven en un parámetro propio,
   eyg.ofertas_contado, que NI el motor NI el portal leen: mientras está en "borrador" no cambia ningún precio.

   Reglas de precio (Dirección): éticos = descuento ENTERO sobre el PVP; el resto = descuento ENTERO sobre
   el precio de lista. Margen mínimo 10%. El precio final NO se redondea: queda al centavo, con la misma
   cuenta del motor (int(ref*(1-d/100)*100+0.5)/100), para que se cobre exactamente lo que dice la oferta.
   Un solo tramo. Si el producto ya tenía una oferta o una escalera, se pausa y manda esta.

   ACTIVAR (sólo con confirmación explícita):
     1. guarda un respaldo de eyg.sync_ofertas(+flat), de la capa de la lista 1 y de eyg.precios_congelados;
     2. pausa las ofertas y escaleras previas de esos productos y saca su precio congelado (si no, el
        motor seguiría publicando el precio de la placa);
     3. agrega una oferta "precio" por producto (reemplaza, perforar autorizado, destino farmacias);
     4. recalcula el motor producto por producto y VERIFICA al centavo lo publicado en la lista 1;
     5. pone los productos en la categoría web "Ofertas de contado" (la del portal).
   DESACTIVAR deshace los pasos 2, 3 y 5 desde el respaldo. */
window.EYGContado = (function(){
  "use strict";
  const KEY="eyg.ofertas_contado", K_SYNC="eyg.sync_ofertas", K_SYNC_FLAT="eyg.sync_ofertas_flat",
        K_CAPA="eyg.precios_fijos_flat", K_CONG="eyg.precios_congelados", LISTA=3;
  const rpc=(m,me,a,k)=>EYG.rpc(m,me,a,k||{});
  const gp=async k=>{ const r=await rpc("ir.config_parameter","get_param",[k]); return (r===false||r==null)?"":r; };
  const sp=(k,v)=>rpc("ir.config_parameter","set_param",[k,String(v)]);
  const c2=n=>"$"+Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const nf=n=>Math.round(n||0).toLocaleString("es-AR");
  const esc=s=>EYG.esc(s);
  const precioDe=(ref,d)=>Math.floor(ref*(1-d/100)*100+0.5)/100;   // la cuenta del motor
  let DOC=null, VIVO={}, ERR="", OCUPADO=false, MSG="";
  try{ MSG=sessionStorage.getItem("ct_msg")||""; sessionStorage.removeItem("ct_msg"); }catch(e){}
  /* después de activar o desactivar se recarga la página: así el módulo relee las ofertas y su sincronización
     de listas institucionales saca las copias de las ofertas que se pausaron */
  function recargar(){ try{ sessionStorage.setItem("ct_msg", MSG); }catch(e){} if(!window._sinRecarga) setTimeout(()=>location.reload(), 1800); }

  async function cargar(){
    ERR="";
    try{ DOC=JSON.parse(await gp(KEY)||"null"); }catch(e){ DOC=null; ERR="No se pudo leer el borrador"; }
    if(!DOC||!Array.isArray(DOC.items)) return DOC;
    // en vivo: stock y lo que hoy publica la lista 1 (para ver la diferencia y, activa, verificar)
    try{
      const tm=DOC.items.map(i=>i.tmpl);
      const [P,PL]=await Promise.all([
        rpc("product.template","read",[tm,["qty_available","list_price"]]),
        rpc("product.pricelist.item","search_read",[[["pricelist_id","=",LISTA],["applied_on","=","1_product"],["product_tmpl_id","in",tm]]],{fields:["product_tmpl_id","min_quantity","fixed_price"]})]);
      VIVO={}; (P||[]).forEach(p=>{ VIVO[p.id]={stock:p.qty_available, pvp:p.list_price, lista:[]}; });
      (PL||[]).forEach(i=>{ const v=VIVO[i.product_tmpl_id[0]]; if(v) v.lista.push([i.min_quantity,i.fixed_price]); });
      Object.values(VIVO).forEach(v=>v.lista.sort((a,b)=>a[0]-b[0]));
    }catch(e){ console.warn("contado vivo:",e); }
    return DOC;
  }
  const activa=()=>DOC&&DOC.estado==="activa";
  function publicadoOK(it){ const v=VIVO[it.tmpl]; return !!(v&&v.lista.length===1&&Math.abs(v.lista[0][1]-it.precio)<0.005); }

  function html(){
    if(ERR) return `<div class="empty">${esc(ERR)}</div>`;
    if(!DOC||!DOC.items||!DOC.items.length) return `<div class="empty">No hay ofertas de contado cargadas.</div>`;
    const it=DOC.items, act=activa();
    const tot=it.reduce((a,i)=>{ const st=(VIVO[i.tmpl]&&VIVO[i.tmpl].stock)||i.stock||0; a.st+=st; a.v+=st*i.precio; a.c+=st*i.costo; return a; },{st:0,v:0,c:0});
    const nOk=act?it.filter(publicadoOK).length:0;
    const estado = act
      ? `<span class="chip" style="background:#E3EEDD;color:#2E7A4E;font-weight:700">ACTIVA desde ${esc(String(DOC.activadaEn||"").slice(0,16).replace("T"," "))}</span> <span class="chip" style="${nOk===it.length?"background:#E3EEDD;color:#2E7A4E":"background:#F5E4DD;color:#A6453A"}">${nOk} de ${it.length} publicadas al centavo</span>`
      : `<span class="chip" style="background:#F3EBD2;color:#8A5E0F;font-weight:700">BORRADOR · no publicada</span> <span style="font-size:12.5px;color:var(--muted,#607570)">Mientras esté en borrador no cambia ningún precio ni se ve en el portal.</span>`;
    const filas=it.map((i,ix)=>{
      const v=VIVO[i.tmpl]||{}; const hoy=v.lista&&v.lista.length?v.lista[v.lista.length-1][1]:null;
      const st=v.stock!=null?v.stock:i.stock;
      const prev=[(i.ofertasPrevias||[]).length?((i.ofertasPrevias.length)+" oferta"+(i.ofertasPrevias.length>1?"s":"")):"", (i.capaPrevia||[]).length?"escalera":""].filter(Boolean).join(" + ");
      const ok=act?(publicadoOK(i)?`<span style="color:#2E7A4E;font-weight:700">✓ publicado</span>`:`<span style="color:#A6453A;font-weight:700">✗ Odoo publica ${hoy!=null?c2(hoy):"—"}</span>`):"";
      return `<tr>
        <td><b>${esc(i.nombre.replace(/\s*\((Precio|Pack|Caja)[^)]*\)?/i,"").slice(0,70))}</b><div class="ctsub">${esc(i.sku||"")} · stock ${nf(st)} u${prev?` · <span title="Se pausa al activar">reemplaza ${prev}</span>`:""}</div></td>
        <td class="n">${i.base==="pvp"?"PVP":"lista"} ${c2(i.ref)}</td>
        <td class="n"><span class="ctdesc">−${i.desc}%</span></td>
        <td class="n"><b>${c2(i.precio)}</b>${i.iva?`<div class="ctsub">+IVA ${i.iva}%</div>`:""}</td>
        <td class="n">${c2(i.costo)}<div class="ctsub">margen ${String(i.margen).replace(".",",")}%</div></td>
        <td class="n">${hoy!=null?c2(hoy):"—"}${act?"<div>"+ok+"</div>":""}</td>
        <td class="n">${act?"":`<button class="btn ghost sm" title="Sacar de la oferta de contado" onclick="EYGContado.quitar(${ix})">✕</button>`}</td></tr>`; }).join("");
    return `<div class="ctbox">
      <div class="cthead">${estado}</div>
      <div class="ctkpis">
        <div><span>Productos</span><b>${it.length}</b></div>
        <div><span>Unidades en stock</span><b>${nf(tot.st)}</b></div>
        <div><span>Si se vende todo</span><b>${c2(tot.v).replace(/,\d\d$/,"")}</b></div>
        <div><span>Ganancia</span><b>${c2(tot.v-tot.c).replace(/,\d\d$/,"")}</b></div>
        <div><span>Pago</span><b>Contado</b></div>
        <div><span>Vigencia</span><b>${DOC.hasta?esc(DOC.hasta.split("-").reverse().join("/")):"sin fecha"}</b></div>
      </div>
      <div class="ctrules">Éticos: descuento entero sobre el PVP · resto: sobre el precio de lista · margen mínimo ${DOC.margenMin||10}% · un solo precio al centavo · solo para farmacias, pago de contado.</div>
      <div class="cttw"><table class="cttab"><thead><tr><th>Producto</th><th class="n">Base</th><th class="n">Descuento</th><th class="n">Precio contado</th><th class="n">Costo</th><th class="n">Hoy en Odoo</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
      ${MSG?`<div class="ctmsg">${MSG}</div>`:""}
      <div class="ctbtns">
        ${act?`<button class="btn ghost" ${OCUPADO?"disabled":""} onclick="EYGContado.verificar()">🔎 Verificar precios en Odoo</button>
               <button class="btn" style="background:#A6453A" ${OCUPADO?"disabled":""} onclick="EYGContado.pedirDesactivar()">Desactivar</button>`
             :`<label class="ctvig">Vigente hasta <input type="date" value="${esc(DOC.hasta||"")}" onchange="EYGContado.vigencia(this.value)"></label>
               <button class="btn" ${OCUPADO?"disabled":""} onclick="EYGContado.pedirActivar()">Activar…</button>`}
      </div></div>`;
  }
  const CSS=`.ctbox{display:grid;gap:12px}.cthead{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .ctkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}.ctkpis div{background:var(--surface,#FFFDF7);border:1px solid var(--line,#DCE4DE);border-radius:10px;padding:8px 11px}
  .ctkpis span{display:block;font-size:11.5px;color:var(--muted,#607570)}.ctkpis b{font-size:17px}
  .ctrules{font-size:12.5px;color:var(--muted,#607570)}.cttw{overflow-x:auto;border:1px solid var(--line,#DCE4DE);border-radius:10px}
  .cttab{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}.cttab th{text-align:left;font-size:11.5px;color:var(--muted,#607570);padding:8px 9px;border-bottom:1px solid var(--line,#DCE4DE);white-space:nowrap}
  .cttab td{padding:7px 9px;border-bottom:1px solid var(--line,#DCE4DE);vertical-align:top}.cttab tr:last-child td{border-bottom:0}.cttab .n{text-align:right;white-space:nowrap}
  .ctsub{font-size:11.5px;color:var(--muted,#607570)}.ctdesc{font-weight:700;color:#064E4D;background:#E8EEDD;border-radius:6px;padding:1px 7px}
  .ctbtns{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end}.ctvig{font-size:13px;display:flex;gap:6px;align-items:center;margin-right:auto}
  .ctmsg{font-size:13px;padding:9px 12px;border-radius:10px;background:#F3EBD2;color:#5d430c;white-space:pre-line}`;
  function css(){ if(!document.getElementById("ct-css")){ const s=document.createElement("style"); s.id="ct-css"; s.textContent=CSS; document.head.appendChild(s); } }

  const repintar=()=>{ try{ window.render&&window.render(); }catch(e){} };
  async function guardarDoc(){ await sp(KEY, JSON.stringify(DOC)); }
  async function quitar(ix){
    if(activa()) return;
    const it=DOC.items[ix]; if(!it) return;
    if(!confirm("¿Sacar "+it.nombre+" de la oferta de contado?")) return;
    const fresco=JSON.parse(await gp(KEY)||"null"); if(!fresco||fresco.estado==="activa"){ alert("La oferta cambió de estado: recargá la página."); return; }
    fresco.items=fresco.items.filter(x=>x.tmpl!==it.tmpl); DOC=fresco; await guardarDoc(); repintar();
  }
  async function vigencia(v){
    if(activa()) return;
    const fresco=JSON.parse(await gp(KEY)||"null"); if(!fresco||fresco.estado==="activa") return;
    fresco.hasta=v||null; DOC=fresco; await guardarDoc(); repintar();
  }

  /* ---------- plan: qué se toca al activar (se muestra antes de confirmar) ---------- */
  async function plan(){
    const [syncRaw, capaRaw, congRaw]=await Promise.all([gp(K_SYNC), gp(K_CAPA), gp(K_CONG)]);
    let SYNC=[]; try{ SYNC=JSON.parse(syncRaw||"[]")||[]; }catch(e){ throw new Error("No se pudo leer eyg.sync_ofertas"); }
    let CONG={}; try{ CONG=JSON.parse(congRaw||"{}")||{}; }catch(e){}
    const T=new Set(DOC.items.map(i=>String(i.tmpl)));
    const pausarOf=SYNC.filter(o=>o.tipo==="p"&&T.has(String(o.target))&&!o.pausada&&!o.contado);
    const capaLineas=String(capaRaw||"").split("\n").filter(l=>l.trim()&&T.has(l.split("~")[0].trim()));
    const pausarCapa=capaLineas.filter(l=>String(l.split("~")[7]||"").trim()!=="1");
    const sacarCong=Object.keys(CONG).filter(k=>T.has(k));
    return {SYNC, CONG, syncRaw, capaRaw, congRaw, pausarOf, pausarCapa, sacarCong};
  }
  function modal(h){ const m=document.getElementById("modal"); if(m) m.innerHTML=`<div class="scrim" onclick="if(event.target===this)EYGContado.cerrar()"><div class="modal" style="max-width:640px;padding:20px 22px">${h}</div></div>`; }
  function cerrar(){ const m=document.getElementById("modal"); if(m) m.innerHTML=""; }
  async function pedirActivar(){
    try{ await cargar(); if(activa()){ repintar(); return; } const p=await plan();
      modal(`<h3 style="margin:0 0 8px">Activar las ofertas de contado</h3>
        <p style="margin:0 0 10px">Se van a publicar <b>${DOC.items.length} precios</b> en la lista de Farmacias y en el portal. Esto es lo que cambia:</p>
        <ul style="margin:0 0 10px;padding-left:18px;font-size:14px">
          <li>${DOC.items.length} ofertas nuevas de precio único, con el margen por debajo del piso <b>autorizado</b>.</li>
          <li>Se pausan <b>${p.pausarOf.length}</b> ofertas anteriores de estos productos y <b>${p.pausarCapa.length}</b> escaleras de la capa.</li>
          <li>Se sacan <b>${p.sacarCong.length}</b> precios congelados por placa (si no, Odoo seguiría publicando el de la placa).</li>
          <li>Los productos entran a la categoría <b>Ofertas de contado</b> del portal.</li></ul>
        <p style="margin:0 0 12px;font-size:13px;color:#607570">Antes se guarda un respaldo de todo; "Desactivar" lo vuelve atrás. Después de activar se verifica al centavo lo que publica Odoo.</p>
        <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin-bottom:12px"><input type="checkbox" id="ct-conf"> Confirmo que quiero publicar estos precios ahora</label>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" onclick="EYGContado.cerrar()">Cancelar</button><button class="btn" onclick="EYGContado.activar()">Activar</button></div>`);
    }catch(e){ alert("No se pudo preparar la activación: "+e.message); }
  }

  async function catContado(crear){
    const r=await rpc("product.public.category","search_read",[[["name","=","Ofertas de contado"]]],{fields:["id"],limit:1});
    if(r&&r[0]) return r[0].id;
    if(!crear) return 0;
    return await rpc("product.public.category","create",[{name:"Ofertas de contado", sequence:1}]);
  }
  async function correrMotor(tmpls, avance){
    const T=await rpc("product.template","read",[tmpls,["product_variant_id"]]);
    let i=0; for(const t of T){ i++; const vid=t.product_variant_id&&t.product_variant_id[0]; if(!vid) continue;
      avance&&avance(i,T.length);
      try{ await rpc("ir.actions.server","run",[[1213]],{context:{lang:"es_AR",eyg_solo_producto:vid}}); }catch(e){ console.warn("motor",t.id,e); } }
  }
  function msg(t){ MSG=t; repintar(); }

  async function activar(){
    const chk=document.getElementById("ct-conf"); if(!chk||!chk.checked){ alert("Tildá la confirmación para activar."); return; }
    cerrar(); if(OCUPADO) return; OCUPADO=true;
    try{
      const fresco=JSON.parse(await gp(KEY)||"null"); if(!fresco||fresco.estado==="activa") throw new Error("Ya estaba activa o no hay borrador.");
      DOC=fresco; const p=await plan();
      // 1. respaldo ANTES de tocar nada
      DOC.backup={at:new Date().toISOString(), sync:p.syncRaw, syncFlat:await gp(K_SYNC_FLAT), capa:p.capaRaw, congRaw:p.congRaw,
        pausadasOf:p.pausarOf.map(o=>o.id), pausadasCapa:p.pausarCapa.map(l=>l.split("~")[0].trim()), congSacados:Object.fromEntries(p.sacarCong.map(k=>[k,p.CONG[k]]))};
      DOC.estado="activando"; await guardarDoc();
      msg("Pausando las ofertas y escaleras anteriores…");
      // 2. pausar ofertas previas y agregar las de contado
      const SYNC=p.SYNC.map(o=>p.pausarOf.some(x=>x.id===o.id)?Object.assign({},o,{pausada:true,pausadaPor:"contado"}):o).filter(o=>!o.contado);
      DOC.items.forEach(i=>SYNC.push({id:"ct"+i.tmpl, tipo:"p", target:i.tmpl, targetName:i.nombre, modo:"precio", valor:i.precio,
        reemplaza:true, hasta:DOC.hasta||"", stock:"", pausada:false, perforar:true, destino:"farm", contado:true}));
      const flat=(window.ofSyncFlat?window.ofSyncFlat(SYNC):SYNC.map(o=>[o.id,o.tipo,o.target,o.modo,o.valor,(o.reemplaza||o.modo==='precio')?1:0,o.hasta||'',o.pausada?1:0,o.stock||0,o.perforar?1:0].join("~")).join("\n"));
      // capa: misma línea con el campo "pausado" (8º) en 1
      const T=new Set(DOC.items.map(i=>String(i.tmpl)));
      const capaNueva=String(p.capaRaw||"").split("\n").map(l=>{ const f=l.split("~"); if(f.length>=9&&T.has(f[0].trim())){ f[7]="1"; return f.join("~"); } return l; }).join("\n");
      const cong=Object.assign({},p.CONG); p.sacarCong.forEach(k=>delete cong[k]);
      await sp(K_SYNC, JSON.stringify(SYNC)); await sp(K_SYNC_FLAT, flat);
      if(capaNueva!==p.capaRaw) await sp(K_CAPA, capaNueva);
      await sp(K_CONG, JSON.stringify(cong));
      // 3. motor, producto por producto
      await correrMotor(DOC.items.map(i=>i.tmpl),(i,n)=>msg(`Recalculando precios en Odoo: ${i} de ${n}…`));
      // 4. portal: categoría web
      msg("Sumando los productos a la categoría del portal…");
      const cat=await catContado(true);
      await rpc("product.template","write",[DOC.items.map(i=>i.tmpl),{public_categ_ids:[[4,cat]]}]);
      DOC.estado="activa"; DOC.activadaEn=new Date().toISOString(); DOC.catWeb=cat; await guardarDoc();
      await cargar(); const mal=DOC.items.filter(i=>!publicadoOK(i));
      MSG=mal.length?("Activada, pero "+mal.length+" precios no coinciden todavía con lo publicado en Odoo:\n"+mal.map(i=>"· "+i.nombre.slice(0,50)+" → oferta "+c2(i.precio)).join("\n")):"Activada. Los "+DOC.items.length+" precios coinciden al centavo con lo publicado en Odoo.";
      recargar();
    }catch(e){ MSG="Error al activar: "+e.message+"\nNo cambió el estado a activa. Revisá antes de reintentar."; }
    OCUPADO=false; repintar();
  }
  async function verificar(){ OCUPADO=true; MSG="Leyendo lo publicado en Odoo…"; repintar(); await cargar(); const mal=DOC.items.filter(i=>!publicadoOK(i)); MSG=mal.length?(mal.length+" precios no coinciden:\n"+mal.map(i=>"· "+i.nombre.slice(0,50)+" → oferta "+c2(i.precio)+" · Odoo "+((VIVO[i.tmpl]&&VIVO[i.tmpl].lista.map(x=>c2(x[1])).join(" / "))||"—")).join("\n")):"Los "+DOC.items.length+" precios coinciden al centavo con Odoo."; OCUPADO=false; repintar(); }
  function pedirDesactivar(){
    modal(`<h3 style="margin:0 0 8px">Desactivar las ofertas de contado</h3>
      <p style="margin:0 0 12px">Se sacan las ${DOC.items.length} ofertas de contado, vuelven las ofertas y escaleras que se habían pausado y los productos salen de la categoría del portal. Los precios congelados por placa no vuelven: el control de placas los arma de nuevo.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" onclick="EYGContado.cerrar()">Cancelar</button><button class="btn" style="background:#A6453A" onclick="EYGContado.desactivar()">Desactivar</button></div>`);
  }
  async function desactivar(){
    cerrar(); if(OCUPADO) return; OCUPADO=true;
    try{
      const fresco=JSON.parse(await gp(KEY)||"null"); if(!fresco||fresco.estado!=="activa") throw new Error("No está activa.");
      DOC=fresco; const b=DOC.backup||{};
      let SYNC=[]; try{ SYNC=JSON.parse(await gp(K_SYNC)||"[]")||[]; }catch(e){ throw new Error("No se pudo leer eyg.sync_ofertas"); }
      const P=new Set(b.pausadasOf||[]);
      SYNC=SYNC.filter(o=>!o.contado).map(o=>(P.has(o.id)&&o.pausadaPor==="contado")?(()=>{ const x=Object.assign({},o,{pausada:false}); delete x.pausadaPor; return x; })():o);
      const flat=(window.ofSyncFlat?window.ofSyncFlat(SYNC):SYNC.map(o=>[o.id,o.tipo,o.target,o.modo,o.valor,(o.reemplaza||o.modo==='precio')?1:0,o.hasta||'',o.pausada?1:0,o.stock||0,o.perforar?1:0].join("~")).join("\n"));
      const C=new Set(b.pausadasCapa||[]); const capaRaw=await gp(K_CAPA);
      const capaNueva=String(capaRaw||"").split("\n").map(l=>{ const f=l.split("~"); if(f.length>=9&&C.has(f[0].trim())){ f[7]="0"; return f.join("~"); } return l; }).join("\n");
      await sp(K_SYNC, JSON.stringify(SYNC)); await sp(K_SYNC_FLAT, flat); if(capaNueva!==capaRaw) await sp(K_CAPA, capaNueva);
      const cat=DOC.catWeb||await catContado(false);
      if(cat) await rpc("product.template","write",[DOC.items.map(i=>i.tmpl),{public_categ_ids:[[3,cat]]}]);
      await correrMotor(DOC.items.map(i=>i.tmpl),(i,n)=>msg(`Recalculando precios en Odoo: ${i} de ${n}…`));
      DOC.estado="borrador"; DOC.desactivadaEn=new Date().toISOString(); await guardarDoc(); await cargar();
      MSG="Desactivada. Volvieron las ofertas y escaleras anteriores."; recargar();
    }catch(e){ MSG="Error al desactivar: "+e.message; }
    OCUPADO=false; repintar();
  }
  return { KEY, cargar, html, css, activa, quitar, vigencia, plan, pedirActivar, activar, verificar, pedirDesactivar, desactivar, cerrar, precioDe,
           n:()=>DOC&&DOC.items?DOC.items.length:0, estado:()=>DOC&&DOC.estado };
})();
