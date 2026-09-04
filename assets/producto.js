/* ===== EyG Core · producto.js — LA FICHA DE PRODUCTO (pieza compartida) =====

   El catálogo es el corazón del sistema: todo lo que la droguería vende pasa
   por acá. Este archivo NO es un módulo: es la pieza que usan los dos módulos
   que tocan productos, para que no haya dos verdades ni dos formularios:

     · inventario/producto.html  — Ficha de producto (buscar, ver, editar, crear)
     · inventario/ingreso.html   — Ingreso de mercadería (escanear, lote, vencimiento)

   Cuando en el ingreso se escanea un código que no está en ningún producto, se
   abre ESTA misma ficha ahí mismo. Por eso vive aparte.

   DÓNDE VIVE CADA DATO (decisión firme: no duplicar nada)
     · Odoo product.template ....... los campos operativos (los de BLOQUES, acá abajo)
     · Odoo product.packaging ...... el embalaje = la caja real, mínimo de compra
     · Odoo product.supplierinfo ... los proveedores con su código y su precio
     · Odoo ir.attachment .......... ficha técnica y fotos extra (igual que Legajos)
     · Supabase vademecum_dato ..... lo que Odoo NO tiene: vía, forma, condición de
                                     venta, ATC, acción terapéutica, GTIN propuesto.
                                     Cada dato con su fuente, su fecha y su evidencia.
     · Supabase maestro_descartes .. las sugerencias de nombre ya descartadas

   NO se creó ninguna tabla nueva. Si aparece un dato que no tiene lugar, el
   lugar es vademecum_dato — no una tabla más.
*/
window.EYGP = (function(){

  /* Odoo devuelve en_US si no se le pide el idioma, y los nombres de producto
     están traducidos: sin esto la ficha muestra un nombre y la web otro. */
  const LANG = {context:{lang:"es_AR"}};
  function rpc(m,me,a,k){ return EYG.rpc(m,me,a,Object.assign({},LANG,k||{})); }
  const ODOO_BASE = "https://drogueriaeyg.odoo.com";

  /* ========================================================================
     1. LOS CAMPOS — la definición ÚNICA de qué es un producto para EyG
     ------------------------------------------------------------------------
     product.template tiene 213 campos. La enorme mayoría son técnicos de Odoo
     y nadie los mira nunca. Estos son los que EyG usa de verdad. Agregar un
     campo a la ficha = agregar UNA línea acá, y aparece en los dos módulos.

     tipo:  char · text · num · money · bool · sel · m2o · m2m · ro (solo lectura)
     ayuda: sale como tooltip al pasar el cursor (regla de la casa: todo campo
            se explica solo).
     ======================================================================== */

  const SEL_TIPO    = [["product","Producto almacenable"],["consu","Consumible"],["service","Servicio"]];
  const SEL_TRACK   = [["none","Sin seguimiento"],["lot","Por lotes"],["serial","Por número de serie único"]];
  const SEL_PMETHOD = [["receive","Sobre cantidades recibidas"],["purchase","Sobre cantidades pedidas"]];
  const SEL_IPOLICY = [["order","Cantidad ordenada"],["delivery","Cantidades entregadas"]];

  /* Las mismas unidades de venta que usa el Maestro de productos. Se guarda la
     CLAVE en x_unidad (no la etiqueta) para que los dos módulos coincidan. */
  const UNIDADES = [
    {k:"unidad",  lbl:"unidad"},      {k:"caja",   lbl:"caja (cerrada)"},
    {k:"tira",    lbl:"tira"},        {k:"blister",lbl:"blister"},
    {k:"amp",     lbl:"ampolla"},     {k:"comp",   lbl:"comprimido"},
    {k:"caps",    lbl:"cápsula"},     {k:"jeringa",lbl:"jeringa"},
    {k:"frasco",  lbl:"frasco"},      {k:"sobre",  lbl:"sobre"},
    {k:"ml",      lbl:"ml"},          {k:"g",      lbl:"gramo"},
    {k:"gotas",   lbl:"gotas"},
  ];

  const BLOQUES = [
    { key:"identidad", ico:"🪪", tit:"Identidad", abierto:true,
      nota:"Lo que identifica al producto. El <b>código de barras</b> es el que se escanea al recibir mercadería: hoy falta en 478 de los 711 productos con stock.",
      campos:[
        {f:"default_code", lbl:"Código interno", tipo:"char", ancho:"chico",
         ayuda:"El código de EyG. Los productos que vienen de Alfabeta usan AB + su código."},
        {f:"barcode", lbl:"Código de barras (GTIN)", tipo:"char", ancho:"medio", escanea:true,
         ayuda:"El código impreso en el envase. Es el que se escanea al recibir. Podés dispararle la pistola parado en este campo."},
        {f:"name", lbl:"Nombre", tipo:"text", ancho:"ancho",
         ayuda:"El nombre es la verdad: de él salen la droga, la concentración, la presentación y el laboratorio. El Maestro de productos propone la forma estándar."},
        {f:"x_laboratorio", lbl:"Laboratorio / Marca", tipo:"char", ancho:"medio",
         ayuda:"Quién lo fabrica. Campo propio del Core; si está cargado le gana a lo que diga el nombre."},
        {f:"active", lbl:"Activo", tipo:"bool",
         ayuda:"Desactivarlo lo saca de todas las listas sin borrarlo. No se pierde el historial."},
        {f:"alfabeta_code", lbl:"Código Alfabeta", tipo:"ro",
         ayuda:"Lo pone el módulo Alfabeta solo, todos los días. No se edita a mano."},
        {f:"die_code", lbl:"Troquel", tipo:"ro",
         ayuda:"Número de troquel. Lo mantiene Alfabeta. Si figura anulado, el troquel ya no vale."},
        {f:"gtins", lbl:"GTIN de Alfabeta", tipo:"ro",
         ayuda:"Ojo: puede traer VARIOS códigos pegados sin separador (28 dígitos = dos de 14)."},
      ]},

    { key:"clasificacion", ico:"🗂️", tit:"Clasificación", abierto:true,
      nota:"La <b>categoría</b> no es decorativa: es la que manda en el motor de precios. Cambiarla cambia cómo se calcula el precio de venta.",
      campos:[
        {f:"categ_id", lbl:"Categoría", tipo:"m2o", cat:"categ", ancho:"ancho",
         ayuda:"Define la escalera de precios y el margen mínimo que aplica el motor."},
        {f:"detailed_type", lbl:"Tipo de producto", tipo:"sel", opts:SEL_TIPO,
         ayuda:"«Almacenable» es el único que lleva stock. Consumible y Servicio no mueven inventario."},
        {f:"monodrug", lbl:"Monodroga", tipo:"ro",
         ayuda:"El principio activo, según el módulo Alfabeta. Solo lo tienen los productos con código Alfabeta."},
        {f:"public_categ_ids", lbl:"Categoría en la web", tipo:"m2m", cat:"pub", ancho:"medio",
         ayuda:"Dónde aparece en el portal. Si está vacío, el producto queda sin familia en la web."},
        {f:"product_tag_ids", lbl:"Etiquetas", tipo:"m2m", cat:"tag", ancho:"medio",
         ayuda:"Etiquetas libres para agrupar productos que no comparten categoría."},
        {f:"is_published", lbl:"Publicado en la web", tipo:"bool",
         ayuda:"Si está apagado, no aparece en el portal ni en el buscador, aunque tenga stock."},
      ]},

    { key:"unidades", ico:"📦", tit:"Unidades y embalaje",
      nota:"<b>Bulto y Embalaje son cosas distintas.</b> El bulto va en el nombre (lo maneja el Maestro); el <b>embalaje</b> de acá es la caja real, el mínimo que se le compra al proveedor.",
      campos:[
        {f:"uom_id", lbl:"Unidad de medida", tipo:"m2o", cat:"uom",
         ayuda:"En qué se mide el stock. Cambiarla con stock cargado rompe la valuación: casi siempre es «Un»."},
        {f:"uom_po_id", lbl:"Unidad de compra", tipo:"m2o", cat:"uom",
         ayuda:"En qué unidad se le compra al proveedor. Normalmente la misma."},
        {f:"x_unidad", lbl:"Unidad de venta (Core)", tipo:"sel", opts:UNIDADES.map(u=>[u.k,u.lbl]),
         ayuda:"Cómo se vende: por tira, por ampolla, por unidad. Es lo que arma el «(Precio x …)» del nombre."},
        {f:"weight", lbl:"Peso (kg)", tipo:"num",
         ayuda:"Peso de una unidad. Sirve para calcular envíos."},
        {f:"volume", lbl:"Volumen (m³)", tipo:"num",
         ayuda:"Volumen de una unidad. Sirve para calcular envíos."},
      ]},

    { key:"compra", ico:"🛒", tit:"Compra y costo",
      nota:"El costo que usa el motor de precios es <b>el más reciente</b> entre el costo manual y la última compra. Acá se ve el que tiene Odoo.",
      campos:[
        {f:"purchase_ok", lbl:"Se puede comprar", tipo:"bool",
         ayuda:"Si está apagado, no aparece para elegir en las órdenes de compra."},
        {f:"standard_price", lbl:"Costo", tipo:"money",
         ayuda:"El costo que tiene Odoo hoy. Es un promedio de las compras, no el último precio pagado."},
        {f:"supplier_taxes_id", lbl:"IVA de compra", tipo:"m2m", cat:"taxc", ancho:"medio",
         ayuda:"El IVA que factura el proveedor."},
        {f:"purchase_method", lbl:"Control de facturas", tipo:"sel", opts:SEL_PMETHOD,
         ayuda:"«Sobre cantidades recibidas» = solo se paga lo que efectivamente llegó. Es lo sano para una droguería."},
      ]},

    { key:"venta", ico:"🏷️", tit:"Venta y precio",
      nota:"Ojo: en la mayoría de los productos el <b>precio de venta de acá queda en 1</b> — el precio real sale de las listas de precios, no de este campo. En los éticos sí es el PVP de Alfabeta.",
      campos:[
        {f:"sale_ok", lbl:"Se puede vender", tipo:"bool",
         ayuda:"Si está apagado, no aparece para elegir en los pedidos ni en Cargar venta."},
        {f:"list_price", lbl:"Precio de venta", tipo:"money",
         ayuda:"En éticos es el PVP de Alfabeta. En el resto casi siempre vale 1 porque el precio lo pone la lista."},
        {f:"taxes_id", lbl:"IVA de venta", tipo:"m2m", cat:"taxs", ancho:"medio",
         ayuda:"El IVA que se le factura al cliente. Los medicamentos éticos suelen ir exentos."},
        {f:"invoice_policy", lbl:"Política de facturación", tipo:"sel", opts:SEL_IPOLICY,
         ayuda:"«Cantidades entregadas» = solo se factura lo que salió del depósito."},
        {f:"sale_delay", lbl:"Plazo de entrega (días)", tipo:"num",
         ayuda:"Cuántos días se le promete al cliente desde que pide."},
        {f:"description_sale", lbl:"Descripción de venta", tipo:"text", ancho:"ancho",
         ayuda:"Texto que ve el cliente en el portal y en el presupuesto."},
      ]},

    { key:"deposito", ico:"🏭", tit:"Depósito y trazabilidad", abierto:true,
      nota:"<b>Estos dos campos son los que después usa el Ingreso de mercadería.</b> Si el seguimiento está mal puesto, la recepción pide un número por cada unidad en vez de uno por lote — es lo que pasó con el camisolín.",
      campos:[
        {f:"tracking", lbl:"Seguimiento", tipo:"sel", opts:SEL_TRACK, ancho:"medio",
         ayuda:"«Por lotes» = un número para toda la partida (lo normal en medicamentos). «Por número de serie» = un número por CADA unidad; casi nunca es lo que se quiere."},
        {f:"use_expiration_date", lbl:"Tiene vencimiento", tipo:"bool",
         ayuda:"Si está prendido, al recibir se pide la fecha de vencimiento del lote."},
        {f:"expiration_time", lbl:"Días hasta vencer", tipo:"num",
         ayuda:"Cuántos días dura desde que se recibe. Con este número Odoo propone la fecha solo."},
        {f:"alert_time", lbl:"Avisar N días antes", tipo:"num",
         ayuda:"Con cuántos días de anticipación avisar que se está por vencer."},
        {f:"responsible_id", lbl:"Responsable", tipo:"m2o", cat:"user",
         ayuda:"Quién se ocupa de reponerlo."},
      ]},

    { key:"contable", ico:"🧾", tit:"Contable",
      nota:"No lo toques salvo que lo pida Administración: definen en qué cuenta contable cae cada venta y cada compra.",
      campos:[
        {f:"property_account_income_id", lbl:"Cuenta de ingresos", tipo:"m2o", cat:"acc", ancho:"ancho",
         ayuda:"A qué cuenta contable va la venta de este producto. Vacío = la de la categoría."},
        {f:"property_account_expense_id", lbl:"Cuenta de gastos", tipo:"m2o", cat:"acc", ancho:"ancho",
         ayuda:"A qué cuenta contable va la compra de este producto. Vacío = la de la categoría."},
      ]},
  ];

  /* Todos los campos de Odoo que hay que leer para armar la ficha. */
  const CAMPOS_LEER = (function(){
    const s = new Set(["id","product_variant_id","qty_available","virtual_available",
                       "is_die_canceled","write_date","create_date"]);
    BLOQUES.forEach(b=>b.campos.forEach(c=>s.add(c.f)));
    return [...s];
  })();

  function campoDef(f){
    for(const b of BLOQUES){ const c=b.campos.find(x=>x.f===f); if(c) return c; }
    return null;
  }

  /* ========================================================================
     2. CATÁLOGOS — las listas de los desplegables
     Son todas chicas (177 categorías, 35 unidades, 35 impuestos, 47 categorías
     web, 25 etiquetas), así que se traen una sola vez y quedan en memoria.
     La única grande es res.partner (1.805): esa se busca escribiendo.
     ======================================================================== */
  const CAT = {};
  let _catProm = null;
  function catalogos(){
    if(_catProm) return _catProm;
    _catProm = (async function(){
      const [categ,uom,taxs,taxc,pub,tag,user,acc] = await Promise.all([
        rpc("product.category","search_read",[[],["id","complete_name"]],{order:"complete_name"}),
        rpc("uom.uom","search_read",[[],["id","name"]],{order:"name"}),
        rpc("account.tax","search_read",[[["type_tax_use","=","sale"]],["id","name"]],{order:"name"}),
        rpc("account.tax","search_read",[[["type_tax_use","=","purchase"]],["id","name"]],{order:"name"}),
        /* product.public.category NO tiene complete_name (sí product.category):
           usa display_name, que es calculado — por eso se ordena por `name`. */
        rpc("product.public.category","search_read",[[],["id","display_name"]],{order:"name"}),
        rpc("product.tag","search_read",[[],["id","name"]],{order:"name"}),
        /* share=false = gente de EyG. Sin ese filtro entraban los 445 usuarios
           activos, que son casi todos CLIENTES con acceso al portal: el
           desplegable de "Responsable" ofrecía farmacias en vez de personas.
           Internos reales: 19. */
        rpc("res.users","search_read",[[["active","=",true],["share","=",false]],["id","name"]],{order:"name"}),
        rpc("account.account","search_read",[[],["id","code","name"]],{order:"code",limit:600}),
      ]);
      CAT.categ = categ.map(r=>[r.id, r.complete_name]);
      CAT.uom   = uom.map(r=>[r.id, r.name]);
      CAT.taxs  = taxs.map(r=>[r.id, r.name]);
      CAT.taxc  = taxc.map(r=>[r.id, r.name]);
      CAT.pub   = pub.map(r=>[r.id, r.display_name]);
      CAT.tag   = tag.map(r=>[r.id, r.name]);
      CAT.user  = user.map(r=>[r.id, r.name]);
      CAT.acc   = acc.map(r=>[r.id, r.code+" "+r.name]);
      return CAT;
    })();
    return _catProm;
  }
  function nombreDe(cat, id){
    const l = (CAT[cat]||[]).find(x=>x[0]===id);
    return l ? l[1] : ("#"+id);
  }

  /* ========================================================================
     3. BUSCAR — tres carriles en una sola lista
     ------------------------------------------------------------------------
     a) el catálogo de Odoo (21.997 productos)   → abrir la ficha
     b) el registro oficial del Ministerio       → crear con esos datos
     c) nada                                     → crear de cero
     ======================================================================== */

  /* Si el texto es SOLO dígitos es un código escaneado o tipeado: se busca
     exacto, no difuso. Un lector de códigos "tipea" el número y manda Enter.
     Mismo criterio que el buscador de la web: sin esto, "14284" devuelve
     cualquier cosa por parecido de números. */
  function esCodigo(q){ return /^[0-9]{6,20}$/.test(String(q||"").trim()); }

  const norm = s => String(s||"").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();

  /* Ordenar por RELEVANCIA, no alfabético.
     Medido contra el catálogo real: buscando "tafirol 1 g", el orden alfabético
     devolvía IBUTAFIROL primero y el TAFIROL 1 G verdadero ni entraba en los
     tres primeros. Con esto: el código exacto manda, después la frase completa,
     después las palabras sueltas; a igualdad gana el nombre más corto (el más
     específico) y lo que hay en el depósito va antes que lo que no. */
  function puntaje(q, r){
    const n = norm(r.name), c = norm(r.default_code), qq = norm(q);
    let p = 0;
    if(c && (c === qq || c === "ab"+qq)) p += 1000;
    if(r.barcode && String(r.barcode) === String(q).trim()) p += 1000;
    const i = n.indexOf(qq);
    if(i === 0) p += 200; else if(i > 0) p += 120;
    qq.split(" ").forEach(tk=>{ if(tk && n.indexOf(tk) >= 0) p += 10; });
    p -= Math.min(n.length, 90)/10;
    if((r.qty_available||0) > 0) p += 30;
    if(r.active === false) p -= 60;      /* los archivados se ven, pero al final */
    return p;
  }

  async function buscarCatalogo(q, lim){
    q = String(q||"").trim();
    if(q.length < 2) return [];
    let dom;
    if(esCodigo(q)){
      /* gtins puede traer varios GTIN pegados sin separador, por eso `like`. */
      dom = ["|","|","|",
             ["barcode","=",q], ["gtins","like",q],
             ["default_code","=",q], ["default_code","=","AB"+q]];
    }else{
      /* Y lógico entre palabras, O entre los campos de cada palabra: "ibu 600"
         trae solo ibuprofeno 600, no todo lo que diga ibu más todo lo que diga
         600. Es el mismo criterio que pidió el usuario para el buscador web. */
      const partes = q.split(/\s+/).filter(Boolean).slice(0,4);
      dom = [];
      for(let i=0;i<partes.length-1;i++) dom.push("&");
      partes.forEach(p=>{
        dom.push("|","|", ["name","ilike",p], ["default_code","ilike",p], ["x_laboratorio","ilike",p]);
      });
    }
    /* Se pide de más y se ordena acá: Odoo no sabe ordenar por relevancia. */
    const tope = lim || 25;
    const filas = await rpc("product.template","search_read",
      [dom, ["id","default_code","name","barcode","categ_id","qty_available","x_laboratorio","active","list_price"]],
      {limit: Math.min(tope*6, 200), order:"name", context:{lang:"es_AR", active_test:false}});
    return (filas||[])
      .map(r=>({r, p:puntaje(q, r)}))
      .sort((a,b)=>b.p - a.p)
      .slice(0, tope)
      .map(x=>x.r);
  }

  /* Un solo producto por código exacto. Lo usa el ingreso al escanear.
     Devuelve null si no existe — que es el caso interesante: ahí se abre el alta. */
  async function porCodigo(cod){
    const r = await buscarCatalogo(String(cod).trim(), 2);
    return r.length ? r[0] : null;
  }

  /* El registro oficial del Ministerio de Salud: la misma API que usa por
     detrás el buscador "Precios de Medicamentos". Pública, oficial, viva y
     citable. No pide token y no tiene el CORS cerrado, así que se llama desde
     el navegador. Devuelve 44 campos por medicamento, con el GTIN adentro. */
  async function buscarRegistro(q){
    q = String(q||"").trim();
    if(q.length < 3) return [];
    try{
      const r = await fetch("https://cnpm.msal.gov.ar/api/vademecum",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({searchdata:q})
      });
      if(!r.ok) return [];
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (j.data || j.result || []);
      return arr.filter(x=>x && x.NOMBRE).slice(0,20);
    }catch(e){ return []; }   /* si la fuente no responde, el carril no aparece y listo */
  }

  /* Traduce un registro del Ministerio a campos de Odoo para precargar el alta.
     Lo que no se puede traducir sin interpretar queda afuera a propósito: la
     categoría y el precio los pone una persona. */
  function desdeRegistro(r){
    const gtin = String(r.GTIN1 || r.C_BARRA || "").trim();
    /* El catálogo YA nombra así a los productos que vienen de Alfabeta:
       "TAFIROL 1 G - blíster comp. x 8 - Genomma Lab.". Se respeta ese formato
       para que el alta no meta un nombre con otra forma que después haya que
       corregir en el Maestro. */
    const nom = [String(r.NOMBRE||"").trim(),
                 String(r.PRESENTACION||"").trim(),
                 String(r.LABORATORIO||"").trim()].filter(Boolean).join(" - ");
    return {
      vals:{
        name: nom,
        barcode: /^[0-9]{8,14}$/.test(gtin) ? gtin : false,
        x_laboratorio: String(r.LABORATORIO||"").trim().toUpperCase() || false,
        detailed_type: "product",
        tracking: "lot",              /* medicamento = por lotes, siempre */
        use_expiration_date: true,
        purchase_method: "receive",
        invoice_policy: "delivery",
      },
      /* Esto no tiene campo en Odoo: va a vademecum_dato, con su fuente. */
      vade: [
        ["droga", r.DROGA], ["via", r.VIA], ["forma_farmaceutica", r.FORMA],
        ["condicion_venta", r.TIPO_DE_VENTA], ["presentacion", r.PRESENTACION],
        ["unidades_envase", r.UNIDADES], ["origen", r.IMPORTADO],
        ["control", r.D_MARCA_CONTROLADO], ["cobertura_pami", r.D_PAMI],
        ["snomed", r.SNOMED], ["troquel", String(r.TROQUEL||"").trim()],
        ["accion_terapeutica", r.ACCION],
      ].filter(x => x[1] && String(x[1]).trim() && String(x[1]).trim() !== "undefined"),
      crudo: r,
    };
  }

  /* ========================================================================
     4. LEER LA FICHA COMPLETA
     ======================================================================== */
  async function leer(tmplId){
    await catalogos();
    const rows = await rpc("product.template","read",[[tmplId], CAMPOS_LEER]);
    const t = rows && rows[0];
    if(!t) throw new Error("El producto "+tmplId+" no existe o fue borrado.");
    const varId = t.product_variant_id && t.product_variant_id[0];

    const [packs, sellers, adj] = await Promise.all([
      varId ? rpc("product.packaging","search_read",
                  [[["product_id","=",varId]],["id","name","qty"]]) : Promise.resolve([]),
      rpc("product.supplierinfo","search_read",
          [[["product_tmpl_id","=",tmplId]],
           ["id","partner_id","product_code","product_name","price","min_qty","delay","date_start","date_end"]],
          {order:"sequence"}),
      rpc("ir.attachment","search_read",
          [[["res_model","=","product.template"],["res_id","=",tmplId]],
           ["id","name","mimetype","file_size","create_date"]],
          {order:"create_date desc", limit:50}),
    ]);

    /* El vademécum es Supabase, no Odoo: se carga aparte para que un problema
       de RLS o de red no impida ver la ficha. */
    return { t, tmplId, varId, packs: packs||[], sellers: sellers||[], adj: adj||[] };
  }

  /* ========================================================================
     5. ESCRIBIR
     ======================================================================== */
  function aOdoo(def, v){
    if(!def) return v;
    switch(def.tipo){
      case "num": case "money": {
        const n = parseFloat(String(v).replace(",", "."));
        return isNaN(n) ? 0 : n;
      }
      case "bool": return !!v;
      case "m2o":  return v ? parseInt(v,10) : false;
      case "m2m":  return [[6, 0, (v||[]).map(x=>parseInt(x,10))]];
      case "char": case "text": case "sel":
        return (v === "" || v == null) ? false : v;
      default: return v;
    }
  }

  async function guardar(tmplId, campo, valor){
    const def = campoDef(campo);
    if(def && def.tipo === "ro")
      throw new Error("«"+def.lbl+"» no se edita a mano: lo mantiene Alfabeta.");
    const vals = {}; vals[campo] = aOdoo(def, valor);
    await rpc("product.template","write",[[tmplId], vals]);
    return vals[campo];
  }

  async function crear(vals){
    /* Odoo completa solo el resto de los obligatorios (unidad, seguimiento,
       avisos). Acá solo va lo que no puede adivinar. */
    const limpio = {};
    Object.keys(vals||{}).forEach(k=>{
      const v = vals[k];
      if(v !== undefined && v !== "" && v !== null) limpio[k] = v;
    });
    if(!limpio.name)     throw new Error("Sin nombre no se puede crear el producto.");
    if(!limpio.categ_id) throw new Error("Falta la categoría: es la que define cómo se calcula el precio.");
    return rpc("product.template","create",[limpio]);
  }

  /* ---- Embalaje (la caja real, mínimo de compra) ---- */
  async function guardarEmbalaje(varId, packId, qty, nombre){
    const n = parseFloat(String(qty).replace(",", ".")) || 0;
    if(packId && n <= 0){ await rpc("product.packaging","unlink",[[packId]]); return null; }
    if(n <= 0) return null;
    if(packId){ await rpc("product.packaging","write",[[packId],{qty:n, name:nombre||"Caja"}]); return packId; }
    return rpc("product.packaging","create",
      [{product_id:varId, qty:n, name:nombre||"Caja", sales:true, purchase:true}]);
  }

  /* ---- Proveedores ---- */
  async function buscarProveedor(q){
    q = String(q||"").trim();
    if(q.length < 2) return [];
    return rpc("res.partner","search_read",
      [["|",["name","ilike",q],["vat","ilike",q]], ["id","name","vat"]],
      {limit:12, order:"name"});
  }
  function guardarProveedor(id, vals){ return rpc("product.supplierinfo","write",[[id], vals]); }
  function agregarProveedor(tmplId, partnerId, vals){
    return rpc("product.supplierinfo","create",
      [Object.assign({product_tmpl_id:tmplId, partner_id:partnerId}, vals||{})]);
  }
  function quitarProveedor(id){ return rpc("product.supplierinfo","unlink",[[id]]); }

  /* ========================================================================
     6. IMAGEN Y ARCHIVOS
     ------------------------------------------------------------------------
     Odoo Online se ahoga con archivos grandes, y la foto de un celular pesa
     4-8 MB. Se achica ACÁ, en el navegador, antes de subirla. Va a image_1920,
     el campo que ya usan la web y Cargar venta — no se inventa un lugar nuevo.
     ======================================================================== */
  function achicar(file, max){
    max = max || 1200;
    return new Promise(function(res, rej){
      const fr = new FileReader();
      fr.onerror = ()=>rej(new Error("No se pudo leer el archivo."));
      fr.onload = function(){
        const img = new Image();
        img.onerror = ()=>rej(new Error("Ese archivo no es una imagen válida."));
        img.onload = function(){
          let w = img.width, h = img.height;
          if(w > max || h > max){ const k = max/Math.max(w,h); w = Math.round(w*k); h = Math.round(h*k); }
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const cx = c.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0,0,w,h);   /* sin esto los PNG con transparencia salen negros */
          cx.drawImage(img, 0, 0, w, h);
          res(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function b64(file){
    return new Promise(function(res, rej){
      const fr = new FileReader();
      fr.onerror = ()=>rej(new Error("No se pudo leer el archivo."));
      fr.onload  = ()=>res(String(fr.result).split(",")[1]);
      fr.readAsDataURL(file);
    });
  }
  async function subirImagen(tmplId, file){
    const datos = await achicar(file, 1200);
    await rpc("product.template","write",[[tmplId],{image_1920:datos}]);
    return datos;
  }
  function borrarImagen(tmplId){ return rpc("product.template","write",[[tmplId],{image_1920:false}]); }
  function urlImagen(tmplId, tam){
    return ODOO_BASE+"/web/image/product.template/"+tmplId+"/image_"+(tam||256);
  }

  /* Ficha técnica, prospecto, fotos extra. Mismo mecanismo que Legajos de
     clientes: ir.attachment colgado del producto. No hace falta storage aparte. */
  async function adjuntar(tmplId, file, descripcion){
    const datas = await b64(file);
    return rpc("ir.attachment","create",[{
      name: file.name, res_model:"product.template", res_id: tmplId, type:"binary",
      datas, mimetype: file.type || "application/octet-stream",
      description: descripcion || null }]);
  }
  function quitarAdjunto(id){ return rpc("ir.attachment","unlink",[[id]]); }
  async function bajarAdjunto(id){
    const r = await rpc("ir.attachment","read",[[id],["datas","mimetype","name"]]);
    const a = r && r[0];
    if(!a || !a.datas) throw new Error("El archivo no tiene contenido.");
    const bin = atob(a.datas), bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], {type: a.mimetype || "application/octet-stream"}));
    const el = document.createElement("a"); el.href = url; el.download = a.name; el.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  /* ========================================================================
     7. EL VADEMÉCUM — lo que Odoo no tiene, con fuente y fecha
     ------------------------------------------------------------------------
     No se creó ninguna tabla: se usa la que ya existe. Cada dato trae de dónde
     salió, cuándo se consultó y con qué evidencia, y lo que entró por
     inferencia queda en «propuesto» hasta que una persona lo mire. Esa revisión
     es justo la que puede hacer Depósito con la caja en la mano.
     ======================================================================== */
  const CAMPO_LBL = {
    droga:"Droga", via:"Vía", forma_farmaceutica:"Forma farmacéutica",
    condicion_venta:"Condición de venta", presentacion:"Presentación",
    unidades_envase:"Unidades por envase", origen:"Origen", control:"Control",
    cobertura_pami:"Cobertura PAMI", snomed:"SNOMED", troquel:"Troquel",
    gtin:"Código de barras (GTIN)", accion_terapeutica:"Acción terapéutica", atc:"ATC",
  };
  const FUENTE_LBL = {
    precios_medicamentos:"Precios de Medicamentos (Ministerio de Salud)",
    anmat_datos_abiertos:"ANMAT — datos abiertos",
    vademecum_es:"vademecum.es", alfabeta:"AlfaBeta",
  };

  async function vade(tmplId){
    try{
      const sb = EYG.supa();
      const {data:prods} = await sb.from("vademecum_producto")
        .select("id,codigo,nombre,revision,droga_id").eq("tmpl", tmplId).limit(1);
      if(!prods || !prods.length) return {producto:null, datos:[]};
      const p = prods[0];
      const {data:datos} = await sb.from("vademecum_dato")
        .select("id,campo,valor,fuente,fecha_consulta,metodo,estado,evidencia,url,notas")
        .eq("ambito","producto").eq("producto_id", p.id).limit(500);
      return {producto:p, datos: datos||[]};
    }catch(e){ return {producto:null, datos:[], error:e.message}; }
  }

  /* Aprobar / rechazar una propuesta.
     ⚠️ Necesita una política de UPDATE para `authenticated` en vademecum_dato:
     hoy la tabla solo tiene SELECT abierto y la escritura es de las edge
     functions. Hasta que esté, esto devuelve el error de RLS sin romper nada. */
  async function vadeResolver(datoId, estado){
    const {error} = await EYG.supa().from("vademecum_dato")
      .update({estado}).eq("id", datoId).select("id");
    if(error) throw new Error(error.message || "No se pudo guardar la revisión.");
    return true;
  }

  return {
    BLOQUES, CAMPOS_LEER, UNIDADES, CAT, CAMPO_LBL, FUENTE_LBL, ODOO_BASE,
    catalogos, nombreDe, campoDef, esCodigo,
    buscarCatalogo, porCodigo, buscarRegistro, desdeRegistro,
    leer, guardar, crear, aOdoo,
    guardarEmbalaje, buscarProveedor, guardarProveedor, agregarProveedor, quitarProveedor,
    achicar, subirImagen, borrarImagen, urlImagen, adjuntar, quitarAdjunto, bajarAdjunto,
    vade, vadeResolver, rpc,
  };
})();
