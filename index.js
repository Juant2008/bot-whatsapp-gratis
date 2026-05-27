const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const mysql = require('mysql2/promise');
const axios = require('axios');

// CAPTURA GLOBAL DE ERRORES EVITA QUE EL BOT MUERA
process.on('unhandledRejection', (err) => {
    const msg = err?.message || err;
    console.log("[UNHANDLED] Error no capturado:", msg);
    if (msg === "Connection Closed" && socketBot) {
        setTimeout(() => startBot(), 3000);
    }
});
process.on('uncaughtException', (err) => {
    console.log("[UNCAUGHT] Error crítico:", err?.message || err);
});

// MODULOS EXTERNOS
const cobranza = require('./cobranza');
const marketingModulo = require('./marketing');
const notificador = require('./notificador_local');

// CONFIGURACION
const PORT = process.env.PORT || 10000;

// LISTA DE ADMINISTRADORES
const ADMIN_IDS = [
    "228621243408492", "97899534934200", "584142531553", "250370957778958", 
    "244362214650069", "60305753296939", "1924162162820", "39058600415402", "58381658247238"
];

const pool = mysql.createPool({
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const PDF_URL_CATALOGO = "https://www.one4cars.com/sevencorpweb/uploads/precios/Catalogo%20-%20ONE4CARS_compressed.pdf";
const MENU_TEXT = `📋 MENÚ PRINCIPAL ONE4CARS
1️⃣  Medios de pago:  https://www.one4cars.com/medios_de_pago.php/
2️⃣  Estado de cuenta:  https://www.one4cars.com/estado_de_cuenta.php/
3️⃣  Lista de precios:  https://www.one4cars.com/lista_de_precios.php/
4️⃣  Tomar pedido:  https://www.one4cars.com/tomar_pedido.php/
5️⃣  Mis clientes/Vendedores:  https://www.one4cars.com/mis_clientes.php/
6️⃣  Afiliar cliente:  https://www.one4cars.com/afiliar_clientes.php/
7️⃣  Consulta de productos:  https://www.one4cars.com/consulta_productos.php/
8️⃣  Seguimiento Despacho:  https://www.one4cars.com/despacho.php/
9️⃣  Asesor Humano:  Indique su duda y un operador revisará el caso pronto.
Escriba el número de la opción o su consulta directamente.`;

const MENU_INTENTIONS = {
    '1': { keywords: ['medios de pago', 'pago movil', 'datos de pago', 'como pagar', 'datos bancarios', 'cuentas para pagar'], response: `1️⃣ *Medios de pago:* https://www.one4cars.com/medios_de_pago.php/` },
    '2': { keywords: ['estado de cuenta', 'cuanto debo', 'listado de facturas pendiente', 'mi saldo', 'facturas pendientes', 'mi deuda', 'listado de facturas', 'cuentas por cobrar'], response: `2️⃣ *Estado de cuenta:* https://www.one4cars.com/estado_de_cuenta.php/` },
    '3': { keywords: ['lista de precios', 'listado de precios', 'catalogo de precios', 'cuanto cuestan', 'pasame la lista', 'ver precios'], response: `3️⃣ *Lista de precios:* https://www.one4cars.com/lista_de_precios.php/` },
    '4': { keywords: ['tomar pedido', 'hacer un pedido', 'quiero comprar', 'realizar pedido'], response: `4️⃣ *Tomar pedido:* https://www.one4cars.com/tomar_pedido.php/` },
    '5': { keywords: ['mis clientes', 'lista de vendedores', 'mis vendedores', 'ver mis clientes'], response: `5️⃣ *Mis clientes/Vendedores:* https://www.one4cars.com/mis_clientes.php/` },
    '6': { keywords: ['afiliar cliente', 'registrar cliente', 'dar de alta cliente', 'nuevo cliente'], response: `6️⃣ *Afiliar cliente:* https://www.one4cars.com/afiliar_clientes.php/` },
    '7': { keywords: ['consulta de productos', 'buscar en inventario', 'ver disponibilidad', 'saber de sus productos', 'buscar repuesto'], response: `7️⃣ *Consulta de productos:* https://www.one4cars.com/consulta_productos.php/` },
    '8': { keywords: ['seguimiento despacho', 'donde esta mi pedido', 'estatus del envio', 'rastrear pedido'], response: `8️⃣ *Seguimiento Despacho:* https://www.one4cars.com/despacho.php/` },
    '9': { keywords: ['asesor humano', 'hablar con un operador', 'soporte humano', 'quiero hablar con alguien', 'ayuda de un operador'], response: `9️⃣ *Asesor Humano:* Indique su duda y un operador revisará el caso pronto. 👩‍💻` }
};

let qrCodeData = "Iniciando...";
let socketBot = null;
let dolarInfo = { bcv: 'Cargando...', paralelo: 'Cargando...' };
let notificadorInterval = null;

// ===== FUNCIONES DE APOYO =====
function normalizar(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,/#!$%^&*;:{}=_`~()?!]/g, "") // Se preserva 'x' y '-' para medidas y códigos
        .toLowerCase()
        .trim();
}

function limpiarRIF(texto) {
    return texto.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function soloNumerosRIF(texto) {
    return texto.replace(/\D/g, '');
}

async function safeSendMessage(jid, content) {
    try {
        if (!socketBot) throw new Error("Socket no inicializado");
        await socketBot.sendMessage(jid, content);
        console.log(`[MSG] ✅ Mensaje enviado a ${jid}`);
    } catch (e) {
        console.log(`[MSG] ❌ Error enviando mensaje:`, e.message);
    }
}

function isBotReady() {
    return socketBot && socketBot.user && socketBot.user.id;
}

function formatWhatsApp(jid) {
    if (!jid) return null;
    if (jid.toString().includes('@')) return jid;
    let clean = jid.toString().replace(/\D/g, '');
    if (clean.startsWith('580')) { clean = '58' + clean.substring(3); }
    if (clean.length > 15) return `${clean}@lid`;
    if (clean.startsWith('0')) clean = clean.substring(1);
    if (!clean.startsWith('58')) clean = '58' + clean;
    return `${clean}@s.whatsapp.net`;
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const randomDelay = async () => {
    const ms = Math.floor(Math.random() * (25000 - 15000 + 1)) + 15000;
    await sleep(ms);
};

async function guardarMensaje(tel, rol, contenido) {
    try {
        await pool.execute("INSERT INTO historial_chat (telefono, rol, contenido) VALUES (?, ?, ?)", [tel, rol, contenido]);
    } catch (e) { console.log("Error guardando historial"); }
}

async function setModo(tel, modo) {
    await pool.execute("INSERT INTO control_chat (telefono, modo) VALUES (?, ?) ON DUPLICATE KEY UPDATE modo = VALUES(modo)", [tel, modo]);
}

async function buscarVendedor(jid, pushName) {
    const telLimpio = jid.split('@')[0];
    const [r] = await pool.execute(
        "SELECT * FROM tab_vendedores WHERE celular_vendedor LIKE ? OR telefono_vendedor LIKE ? OR nombre LIKE ? LIMIT 1",
        [`%${telLimpio}%`, `%${telLimpio}%`, `%${pushName}%`]
    );
    return r[0] || null;
}

function detectarIntencionMenu(texto) {
    if (!texto) return null;
    if (/^\d$/.test(texto)) {
        const num = texto.charAt(0);
        if (MENU_INTENTIONS[num]) return MENU_INTENTIONS[num].response;
    }
    for (const key in MENU_INTENTIONS) {
        const intention = MENU_INTENTIONS[key];
        if (intention.keywords.some(phrase => texto.includes(phrase))) {
            return intention.response;
        }
    }
    return null;
}

// ===== BASE DE DATOS =====
async function initDB() {
    try {
        await pool.execute(`CREATE TABLE IF NOT EXISTS control_chat ( telefono VARCHAR(100) PRIMARY KEY, usuario VARCHAR(50), id_cliente_int INT, modo VARCHAR(20) DEFAULT 'bot', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci`);
        await pool.execute(`CREATE TABLE IF NOT EXISTS historial_chat ( id INT AUTO_INCREMENT PRIMARY KEY, telefono VARCHAR(100), rol ENUM('user', 'model'), contenido TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci`);
        await pool.execute(`CREATE TABLE IF NOT EXISTS recordatorios_log ( id INT AUTO_INCREMENT PRIMARY KEY, id_factura INT NOT NULL, nivel INT NOT NULL, fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_recordatorio (id_factura, nivel) ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci`);
        await pool.execute(`CREATE TABLE IF NOT EXISTS envio_vendedor_log ( id INT AUTO_INCREMENT PRIMARY KEY, fecha_envio DATE NOT NULL ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci`);
        console.log("✅ Base de Datos vinculada.");
    } catch (e) { console.log("❌ Error DB Init:", e.message); }
}

async function getSesion(jid) {
    const [r] = await pool.execute("SELECT * FROM control_chat WHERE telefono=?", [jid]);
    return r[0] || null;
}

async function guardarUsuario(jid, usuario, id_int) {
    await pool.execute(`INSERT INTO control_chat (telefono, usuario, id_cliente_int, modo) VALUES (?, ?, ?, 'bot') ON DUPLICATE KEY UPDATE usuario=VALUES(usuario), id_cliente_int=VALUES(id_cliente_int), modo='bot'`, [jid, usuario, id_int]);
}

async function buscarCliente(rifLimpio) {
    const soloNum = soloNumerosRIF(rifLimpio);
    const [r] = await pool.execute(
        `SELECT id_cliente, nombres, celular, cedula, direccion, zona FROM tab_clientes WHERE REPLACE(REPLACE(clave, '-', ''), '.', '') = ? OR REPLACE(REPLACE(clave, '-', ''), '.', '') = ? OR clave LIKE ? LIMIT 1`,
        [rifLimpio, soloNum, `%${soloNum}%`]
    );
    return r[0] || null;
}

async function obtenerDetalleFacturas(id_cliente, id_vendedor = null) {
    let query = `SELECT f.id_factura, f.nro_factura, f.total, f.abono_factura, f.fecha_reg, f.porcentaje, f.descuento, f.total_desc, c.nombres, c.direccion, c.cedula, c.celular, c.telefono, c.id_cliente, c.zona, c.vendedor as nombre_vendedor FROM tab_facturas f JOIN tab_clientes c ON f.id_cliente = c.id_cliente WHERE f.id_cliente = ? AND f.pagada = 'NO' AND f.anulado = 'no'`;
    let params = [id_cliente];
    if (id_vendedor) { query += ` AND f.id_vendedor = ?`; params.push(id_vendedor); }
    const [facturas] = await pool.execute(query, params);
    return facturas;
}

async function actualizarDolar() {
    try {
        const resOficial = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 7000 });
        if (resOficial.data) dolarInfo.bcv = parseFloat(resOficial.data.promedio).toFixed(2);
        const resParalelo = await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo', { timeout: 7000 });
        if (resParalelo.data) dolarInfo.paralelo = parseFloat(resParalelo.data.promedio).toFixed(2);
    } catch (e) { console.log("Error Dolar API"); }
}

// ===== BÚSQUEDA TRIPLE Y MEDIDAS (NUEVA IMPLEMENTACIÓN) =====
async function buscarProductoTriple(textoOriginal) {
    const textoNorm = normalizar(textoOriginal);
    
    // Preparar términos para medidas: preservar 'x' y manejar espacios
    const terminaMedida = textoOriginal.replace(/\s*x\s*/gi, 'x').toLowerCase().trim();
    const terminaMedidaEspaciada = textoOriginal.replace(/\s*x\s*/gi, ' x ').toLowerCase().trim();

    // StopWords existentes para lenguaje natural
    const stopWords = [
        'tienes', 'la', 'del', 'quiere', 'saber', 'cuanto', 'mide', 'venden', 'donde',
        'precio', 'tienen', 'el', 'una', 'un', 'hay', 'si', 'es', 'de', 'con', 'para',
        'busco', 'hola', 'buenos', 'buenas', 'dias', 'tardes', 'noches', 'como', 'estas',
        'esta', 'familia', 'espero', 'encuentres', 'encuenters', 'bien', 'queria',
        'preguntarte', 'gracias', 'por', 'favor', 'ayuda', 'puedes', 'podrias',
        'quisiera', 'necesito', 'saludos', 'cordial', 'muchas', 'todo', 'bienvenidos',
        'bendiciones', 'exito', 'exitos', 'dia', 'tarde', 'noche', 'pregunta', 'consulta',
        'atento', 'atenta', 'saludo', 'estimados', 'estimado', 'buen', 'buena', 'bueno',
        'se', 'me', 'le', 'te', 'lo', 'los', 'las', 'les', 'su', 'sus', 'mi', 'mis',
        'tu', 'tus', 'nos', 'os', 'que', 'cual', 'cuales', 'quien', 'quienes',
        'cuando', 'porque', 'pues', 'pero', 'mas', 'muy', 'asi', 'aun', 'entre', 'sin',
        'sobre', 'tras', 'durante', 'mediante', 'excepto', 'segun', 'puede', 'puedo',
        'pueden', 'podemos', 'podria', 'hacer', 'hace', 'hacen', 'ser', 'estar', 'tener',
        'tengo', 'tenemos', 'tiene', 'decir', 'dice', 'dicen', 'digo', 'ver', 'veo',
        'ven', 'vez', 'veces', 'quiero', 'quiere', 'quieren', 'queremos', 'gustaria',
        'gusta', 'gustan', 'gusto', 'necesita', 'necesitan', 'necesitamos', 'pueda',
        'UNID.', 'unid.', 'unidades', 'unidad', 'UNIDADES', 'unidades',
        'puedas', 'pudiera', 'pudieras', 'listo', 'claro', 'ok', 'okey', 'vale', 'va',
        'vamos', 'vaya', 'algun', 'alguna', 'algunos', 'algunas', 'ningun', 'ninguna',
        'tipo', 'tipos', 'preguntar', 'disculpa', 'disculpe', 'permiso', 'ayudar',
        'apoyo', 'consulta', 'consultar', 'info', 'informacion', 'decirme', 'dime',
        'avísame', 'avisa', 'saber', 'sabes', 'saben', 'sabemos',
        'pana', 'panas', 'brother', 'bro', 'amigo', 'amigos', 'compa', 'compadre',
        'ando', 'andas', 'andan', 'andaba', 'andabas', 'andabamos', 'andaban',
        'estoy', 'estas', 'esta', 'estaba', 'estabas', 'estabamos', 'estaban',
        'vengo', 'vienes', 'viene', 'vienen', 'venia', 'venias', 'veniamos', 'venian',
        'voy', 'vas', 'va', 'vamos', 'van', 'iba', 'ibas', 'ibamos', 'iban',
        'llegando', 'pais', 'país', 'atento'
    ];

    const palabrasBase = textoNorm.split(' ').filter(p => p.length > 2 && !stopWords.includes(p));
    const stockCondition = "(cantidad_existencia + cantidad_existencia_almacen > 0)";
    
    // 1. INTENTO DIRECTO (Códigos cortos o Medidas)
    if (palabrasBase.length <= 2 || terminaMedida.includes('x')) {
        try {
            let sqlDirecto = `SELECT producto, descripcion, tipo, precio_final, (cantidad_existencia + cantidad_existencia_almacen) as stock 
                              FROM tab_productos 
                              WHERE ${stockCondition} AND (
                                  producto LIKE ? OR 
                                  producto LIKE ? OR 
                                  descripcion LIKE ? OR 
                                  descripcion LIKE ? OR 
                                  CONCAT(' ', TRIM(equivalencia), ' ') LIKE CONCAT('% ', ?, ' %')
                              ) LIMIT 8`;
            let params = [terminaMedida, `${terminaMedida}%`, `%${terminaMedida}%`, `%${terminaMedidaEspaciada}%`, terminaMedida];
            const [rows] = await pool.execute(sqlDirecto, params);
            if (rows.length > 0) return rows;
        } catch (e) { console.log("Error Intento Directo:", e.message); }
    }

    // 2. INTENTO RELEVANCIA (Lenguaje Natural + Triple Campo)
    if (palabrasBase.length > 0) {
        try {
            // Expandir plurales/singulares para equivalencia y descripción
            const expandir = (p) => {
                const forms = [p];
                if (p.endsWith('es') && p.length > 4) forms.push(p.slice(0, -2));
                if (p.endsWith('s') && !p.endsWith('es')) forms.push(p.slice(0, -1));
                if (!p.endsWith('s')) { forms.push(p + 's'); if (p.endsWith('z')) forms.push(p.slice(0, -1) + 'ces'); }
                return [...new Set(forms)];
            };

            const terminosExpandidos = [...new Set(palabrasBase.flatMap(expandir))];
            const orConds = terminosExpandidos.map(() => `(producto LIKE ? OR descripcion LIKE ? OR CONCAT(' ', TRIM(equivalencia), ' ') LIKE CONCAT('% ', ?, ' %'))`);
            const params = terminosExpandidos.flatMap(t => [`%${t}%`, `%${t}%`, t]);

            // Relevance scoring
            const relevanceParts = palabrasBase.map(p => {
                const forms = expandir(p);
                const cases = forms.map(f => `(descripcion LIKE '%${f}%' OR producto LIKE '%${f}%')`);
                return `(CASE WHEN ${cases.join(' OR ')} THEN 1 ELSE 0 END)`;
            });
            const relevanceSQL = relevanceParts.join(' + ');
            const minRelevance = palabrasBase.length >= 3 ? (palabrasBase.length >= 5 ? 3 : 2) : 1;

            const sqlRel = `SELECT producto, descripcion, tipo, precio_final, (cantidad_existencia + cantidad_existencia_almacen) as stock 
                            FROM tab_productos 
                            WHERE ${stockCondition} AND (${orConds.join(' OR ')})
                            HAVING (${relevanceSQL}) >= ? 
                            ORDER BY ${relevanceSQL} DESC LIMIT 8`;
            
            const [rows] = await pool.execute(sqlRel, [...params, minRelevance]);
            if (rows.length > 0) return rows;
        } catch (e) { console.log("Error Intento Relevancia:", e.message); }
    }
    return null;
}

// ===== NOTIFICADOR DE FACTURAS NUEVAS =====
let notificadorEjecutando = false;
async function checkNuevasFacturas() {
    if (!isBotReady() || notificadorEjecutando) return;
    notificadorEjecutando = true;
    try {
        const facturas = await notificador.obtenerFacturasNoNotificadas();
        for (const f of facturas) {
            const jid = formatWhatsApp(f.celular);
            if (!jid) continue;
            const fecha = new Date(f.fecha_reg).toISOString().split('T')[0];
            const msg = `🧾 *NUEVA FACTURA REGISTRADA*\n\nHola *${f.nombres}*, se ha registrado una nueva factura en nuestro sistema:\n\n🔹 *N°:* ${f.nro_factura}\n🔹 *Monto:* $${parseFloat(f.total).toFixed(2)}\n🔹 *Fecha:* ${fecha}\n\nPuede consultar su estado de cuenta en:\nhttps://www.one4cars.com/estado_de_cuenta.php/`;
            await safeSendMessage(jid, { text: msg });
            if (f.celular_vendedor) {
                const jidV = formatWhatsApp(f.celular_vendedor);
                if (jidV) {
                    const msgV = `📢 *NUEVA FACTURA DE SU CLIENTE*\n\nVendedor: *${f.vendedor_nombre || 'N/A'}*\nCliente: *${f.nombres}*\n\n🔹 *N° Factura:* ${f.nro_factura}\n🔹 *Monto:* $${parseFloat(f.total).toFixed(2)}\n🔹 *Fecha:* ${fecha}`;
                    await safeSendMessage(jidV, { text: msgV });
                }
            }
            await pool.execute("UPDATE tab_facturas SET whatsapp_notificado = 'SI' WHERE id_factura = ?", [f.id_factura]);
            await sleep(1000);
        }
        if (facturas.length > 0) console.log(`[NOTIFICADOR] ${facturas.length} factura(s) notificada(s).`);
    } catch (e) { console.log("[NOTIFICADOR] Error:", e.message); } finally { notificadorEjecutando = false; }
}

// ===== RECORDATORIOS DE FACTURAS VENCIDAS =====
let recordatorioEjecutando = false;
function obtenerNivelRecordatorio(dias) {
    if (dias >= 60) return 60;
    if (dias >= 50) return 50;
    if (dias >= 40) return 40;
    if (dias >= 30) return 30;
    return null;
}
function obtenerTonoMensaje(nivel, f, monto, fecha) {
    if (nivel >= 60) {
        return `🧾 *AVISO DE PAGO PENDIENTE*\n\nHola *${f.nombres}*, la factura *N° ${f.nro_factura}* emitida el *${fecha}* ya superó los 60 días de vencida con un saldo de *$${monto.toFixed(2)}*.\n\nEl retraso en el pago afecta la rotación de nuestros productos y la disponibilidad de inventario para todos nuestros clientes. Le agradecemos realizar el pago a la mayor brevedad posible.\n\nQuedamos a su disposición para cualquier duda o gestión. 🚗`;
    }
    return `🧾 *RECORDATORIO DE PAGO*\n\nHola *${f.nombres}*, le recordamos amablemente que la factura *N° ${f.nro_factura}* con fecha *${fecha}* presenta un saldo pendiente de *$${monto.toFixed(2)}*.\n\nLe agradecemos gestionar el pago para mantener su cuenta al día. Estamos a su disposición para cualquier consulta. 🚗`;
}
async function checkFacturasVencidas() {
    if (!isBotReady() || recordatorioEjecutando) return;
    recordatorioEjecutando = true;
    try {
        const facturas = await notificador.obtenerFacturasVencidas();
        const enviados = await notificador.obtenerRecordatoriosEnviados();
        let cont = 0;
        for (const f of facturas) {
            const dias = f.dias_vencida;
            const nivel = obtenerNivelRecordatorio(dias);
            if (!nivel) continue;
            const monto = (parseFloat(f.total) - parseFloat(f.abono_factura || 0)) / (parseFloat(f.porcentaje) || 1);
            if (monto <= 0) continue;
            const fecha = new Date(f.fecha_reg).toISOString().split('T')[0];
            const yaEnviado = enviados[f.id_factura] && enviados[f.id_factura].includes(nivel);
            if (!yaEnviado) {
                const jid = formatWhatsApp(f.celular);
                if (jid) {
                    const msg = obtenerTonoMensaje(nivel, f, monto, fecha);
                    await safeSendMessage(jid, { text: msg });
                }
                await notificador.marcarRecordatorio(f.id_factura, nivel);
                cont++;
                await sleep(1000);
            }
        }
        if (cont > 0) console.log(`[RECORDATORIO] ${cont} cliente(s) notificado(s).`);
    } catch (e) { console.log("[RECORDATORIO] Error:", e.message); } finally { recordatorioEjecutando = false; }
}

// ===== RECORDATORIO A VENDEDORES =====
let vendedorEjecutando = false;
async function checkVendedoresRecordatorio() {
    if (!isBotReady() || vendedorEjecutando) return;
    vendedorEjecutando = true;
    try {
        const hoy = new Date().getDay();
        if (hoy === 0 || hoy === 6) return;
        const ultimo = await notificador.obtenerUltimoEnvioVendedor();
        if (ultimo) {
            const diff = Math.floor((new Date() - new Date(ultimo)) / 86400000);
            if (diff < 3) return;
        }
        const facturas = await notificador.obtenerFacturasVencidasAll();
        const vendedoresMap = {};
        for (const f of facturas) {
            const dias = f.dias_vencida;
            if (dias < 30) continue;
            let monto = (parseFloat(f.total) - parseFloat(f.abono_factura || 0)) / (parseFloat(f.porcentaje) || 1);
            if (monto <= 0 || !f.celular_vendedor) continue;
            if (f.vendedor_nombre && f.vendedor_nombre.toUpperCase() === 'MANUEL FERRAZ') monto = monto / 0.80;
            const key = f.celular_vendedor.toString().replace(/\D/g, '');
            if (!vendedoresMap[key]) {
                vendedoresMap[key] = { nombre: f.vendedor_nombre || 'Vendedor', jid: formatWhatsApp(f.celular_vendedor), facturas: [] };
            }
            vendedoresMap[key].facturas.push(`🔹 *N° ${f.nro_factura}* - ${f.nombres} - $${monto.toFixed(2)} (${dias} días)`);
        }
        for (const key of Object.keys(vendedoresMap)) {
            const v = vendedoresMap[key];
            if (!v.jid || v.facturas.length === 0) continue;
            const msg = `📢 *RESUMEN DE CLIENTES VENCIDOS*\n\nVendedor: *${v.nombre}*\n\n${v.facturas.join('\n')}\n\nLe recordamos la importancia de gestionar estos cobros para mantener la rotación de productos.`;
            await safeSendMessage(v.jid, { text: msg });
            await sleep(1000);
        }
        await notificador.marcarEnvioVendedor();
        console.log(`[VENDEDORES] ${Object.keys(vendedoresMap).length} vendedor(es) notificado(s).`);
    } catch (e) { console.log("[VENDEDORES] Error:", e.message); } finally { vendedorEjecutando = false; }
}

// ===== BOT WHATSAPP =====
async function startBot() {
    if (socketBot) {
        try { socketBot.removeAllListeners(); socketBot.end(undefined); } catch (e) {}
        socketBot = null;
    }
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["ONE4CARS MASTER", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, { scale: 10 }, (_, url) => qrCodeData = url);
        if (connection === 'open') { 
            qrCodeData = "ONLINE ✅"; 
            console.log("🚀 BOT MASTER ONLINE");
            if (!notificadorInterval) {
                notificadorInterval = setInterval(checkNuevasFacturas, 45000);
                setInterval(checkFacturasVencidas, 86400000);
                setInterval(checkVendedoresRecordatorio, 86400000);
                setInterval(() => { if (!isBotReady() && socketBot) startBot(); }, 300000);
            }
        }
        if (connection === 'close') {
            const r = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (r) setTimeout(() => startBot(), 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;

            const from = msg.key.remoteJid;
            if (from === 'status@broadcast' || from.includes('@g.us')) return;

            const isAdmin = ADMIN_IDS.some(id => from.includes(id));
            const vendedor = await buscarVendedor(from, msg.pushName || "Vendedor");

            if (msg.key.fromMe) {
                const textMe = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();
                if (textMe === '!bot') {
                    await setModo(from, 'bot');
                    await safeSendMessage(from, { text: "🤖 Bot reactivado para este chat." });
                } else {
                    await setModo(from, 'humano');
                }
                return;
            }

            const pushName = msg.pushName || "Usuario";
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!rawText) return;

            const text = normalizar(rawText);
            await guardarMensaje(from, 'user', rawText);
            const sesion = await getSesion(from);
            
            // 1. REGLA ESTRICTA: Si es humano y NO es admin, bloquear flujo de RIF/Cobranza
            if (sesion && sesion.modo === 'humano' && !isAdmin) return;

            // --- 2. DETECCIÓN INTELIGENTE DEL MENÚ ---
            const menuOption = detectarIntencionMenu(text);
            if (menuOption) {
                if (menuOption.includes('Estado de cuenta')) {
                    const targetID = sesion?.id_cliente_int;
                    if (!targetID) return await safeSendMessage(from, { text: "Para consultar su estado de cuenta, por favor envíe su *RIF* para identificarlo." });
                    const facturas = await obtenerDetalleFacturas(targetID);
                    if (facturas.length === 0) return await safeSendMessage(from, { text: "✅ No posee facturas pendientes." });
                    let totalP = 0; let listado = "*📄 FACTURAS PENDIENTES:*\n\n";
                    facturas.forEach(f => {
                        const monto = (f.total - f.abono_factura) / (f.porcentaje || 1);
                        totalP += monto;
                        const fReg = new Date(f.fecha_reg).toISOString().split('T')[0];
                        const params = `id_factura=${f.id_factura}&nro_factura=${f.nro_factura}&fecha_reg=${fReg}&total=${f.total}&abono_factura=${f.abono_factura}&nombres=${encodeURIComponent(f.nombres.trim())}&nombre=${encodeURIComponent(f.nombre_vendedor.trim())}&direccion=${encodeURIComponent(f.direccion.trim())}&cedula=${f.cedula.trim()}&celular=${encodeURIComponent(f.celular.trim())}&telefono=${encodeURIComponent(f.telefono.trim())}&id_cliente=${f.id_cliente}&zona=${encodeURIComponent(f.zona.trim())}&descuento=${f.descuento}&total_desc=${f.total_desc}`;
                        listado += `🔸 *#${f.nro_factura}* | $${monto.toFixed(2)}\n📄 PDF: https://one4cars.com/sevencorp/factura_full_reporte_web.php?${params}\n\n`;
                    });
                    listado += `💰 *TOTAL A PAGAR: $${totalP.toFixed(2)}*`;
                    return await safeSendMessage(from, { text: listado });
                }
                return await safeSendMessage(from, { text: menuOption });
            }
            
            // --- 3. FLUJO POR ROL Y PRIORIDAD ---
            const textoLimpio = rawText.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            
            // Solo los Admins pueden procesar RIFs
            let esRIFValido = false;
            if (isAdmin) {
                // Patrón: Letra + 8-9 dígitos O SOLO números (9+ dígitos). EXCLUYE <=6 dígitos.
                const esLetraNumeros = /^[VJGE]\d{8,9}$/.test(textoLimpio);
                const esSoloNumeros = /^\d{9,}$/.test(textoLimpio);
                const longitudValida = textoLimpio.length > 6;
                esRIFValido = longitudValida && (esLetraNumeros || esSoloNumeros);
            }

            // --- LÓGICA RIF (SOLO ADMIN) ---
            if (esRIFValido) {
                const rifLimpio = limpiarRIF(rawText);
                const c = await buscarCliente(rifLimpio);
                if (c) {
                    await guardarUsuario(from, rifLimpio, c.id_cliente);
                    const facturas = await obtenerDetalleFacturas(c.id_cliente);
                    let totalP = 0; 
                    let list = `⭐ *CONSULTA DE ESTADO DE CUENTA (ADMIN)*\nCliente: ${c.nombres}\nRIF: ${rifLimpio}\n\n`;
                    if (facturas.length === 0) {
                        list += `✅ Sin facturas pendientes.`;
                    } else {
                        facturas.forEach(f => {
                            const monto = (f.total - f.abono_factura) / (f.porcentaje || 1);
                            totalP += monto;
                            list += `🔸 *#${f.nro_factura}* | $${monto.toFixed(2)}\n`;
                            list += `✍️ Firmada: https://www.one4cars.com/uploads/notas/${f.nro_factura}.jpg\n\n`;
                        });
                        list += `💰 *TOTAL A PAGAR: $${totalP.toFixed(2)}*`;
                    }
                    return await safeSendMessage(from, { text: list });
                } else {
                    return await safeSendMessage(from, { text: "❌ No se encontró ningún cliente con ese RIF." });
                }
            }

            // --- LÓGICA DE PRODUCTOS (TRIPLE BÚSQUEDA + MEDIDAS) ---
            // Aplica para TODOS los usuarios si no fue RIF válido.
            if (text === 'pago fact' || text === 'abono' || text.includes('pago') || text.includes('al señor oscar') || text.includes('envié el pago') || text.includes('adjunto pago')) {
                const nombreUsuario = vendedor ? vendedor.nombre : pushName;
                return await safeSendMessage(from, { text: `¡Hola *${nombreUsuario}*! Gracias por su mensaje. 😊\n\nRecibido tu mensaje, administración validará su pago a la brevedad.\n\n${MENU_TEXT}` });
            }

            if (text === 'factura fiscal' || text.includes('factura con iva')) {
                const nombreUsuario = vendedor ? vendedor.nombre : pushName;
                return await safeSendMessage(from, { text: `¡Hola *${nombreUsuario}*! Gracias por su mensaje. 😊\n\nLa Factura Fiscal será realizada de acuerdo con su solicitud el día que tenga disponibilidad de hacer el pago.\n\n${MENU_TEXT}` });
            }
            
            if (text.includes("cuando llega mi pedido") || text.includes("tiempo tardan en despachar") || text.includes("cuando me llega") || text.includes("tiempo de entrega") || text.includes("cuanto tarda el envio")) {
                return await safeSendMessage(from, { text: "Saludos estimado cliente, su pedido está disponible en un lapso no mayor de 24 horas." });
            }

            if (text === 'hola buenos dias' || text === 'buenos dias' || text === 'como estas' || text === 'como estas tu' || text === 'hola como estas') {
                return await safeSendMessage(from, { text: `¡Hola! Gusto en saludarlo estimado. Buenos días también para usted. ¿Cómo está? Aca estamos, gracias por preguntar. Estoy atento para lo que necesite. 😊\n\n${MENU_TEXT}` });
            }

            // Filtro conversacional aleatorio para evitar spam en búsquedas cortas sin intención
            const palabras = rawText.split(/\s+/);
            const palabrasClaveInventario = ['yaris', 'fiesta', 'rolinera', 'tapa', 'tapas', 'filtro', 'filtros', 'radiador', 'motor', 'envase', 'deposito', 'refrigerante', 'ka', 'ecosport', 'optra', 'empacadura', 'valvula', 'cerato'];
            const contienePalabraInventario = palabrasClaveInventario.some(p => text.includes(p));
            
            let esConversacionalAleatorio = false;
            if (!['dolar', 'bcv', 'paralelo', 'menu', 'hola', 'buen dia', 'buenos dias', 'buenas tardes', 'pago fact', 'abono', 'como estas', 'como estas tu'].includes(text)) {
                if (isAdmin && palabras.length > 5 && !contienePalabraInventario) esConversacionalAleatorio = true;
                if (!isAdmin) {
                    const palabrasFiltro = palabras.filter(p => p.length > 1);
                    const tieneIntencion = text.includes('tienes') || text.includes('hay') || text.includes('busco') || text.includes('precio') || text.includes('venden') || text.includes('disponibilidad') || text.includes('buscar') || text.includes('necesito') || text.includes('cotizar') || text.includes('repuesto') || text.includes('producto') || contienePalabraInventario;
                    if (!tieneIntencion && palabrasFiltro.length > 6) esConversacionalAleatorio = true;
                }
            }
            if (esConversacionalAleatorio) return;

            // Ejecutar búsqueda triple
            try {
                let prods = await buscarProductoTriple(rawText);
                if (prods && prods.length > 0) {
                    const conStock = prods.filter(p => parseFloat(p.stock) > 0);
                    const agotados = prods.filter(p => parseFloat(p.stock) <= 0);

                    await safeSendMessage(from, { text: "🔍 *Resultados de búsqueda en inventario:* 👇" });
                    await sleep(1000);

                    for (const p of conStock) {
                        if (!isBotReady()) break; 
                        const precioLimpio = parseFloat(p.precio_final || 0).toFixed(2);
                        const caption = `📦 *CÓDIGO: ${p.producto}*\n💰 *Precio Final: $${precioLimpio}*\n📝 ${p.descripcion}\n🔗 Ficha: https://one4cars.com/producto_general.php?cod=${p.producto}&tipo=${encodeURIComponent(p.tipo)}`;
                        const imgUrl = `https://one4cars.com/imagen/${p.producto}.jpg`;
                        try { await socketBot.sendMessage(from, { image: { url: imgUrl }, caption: caption }); } catch (imgErr) { await safeSendMessage(from, { text: caption }); }
                        await sleep(1500);
                    }
                    for (const p of agotados) {
                        if (!isBotReady()) break;
                        const precioLimpio = parseFloat(p.precio_final || 0).toFixed(2);
                        const msgAgotado = `⚠️ *AVISO: PRODUCTO AGOTADO*\n\n📦 *CÓDIGO: ${p.producto}*\n💰 *Precio: $${precioLimpio}*\n📝 ${p.descripcion}\n🔗 Ficha: https://one4cars.com/producto_general.php?cod=${p.producto}&tipo=${encodeURIComponent(p.tipo)}\n\n_Este producto actualmente no tiene disponibilidad._`;
                        const imgUrl = `https://one4cars.com/imagen/${p.producto}.jpg`;
                        try { await socketBot.sendMessage(from, { image: { url: imgUrl }, caption: msgAgotado }); } catch (imgErr) { await safeSendMessage(from, { text: msgAgotado }); }
                        await sleep(1500);
                    }
                    return;
                }
            } catch (e) { console.log("Error en flujo de productos:", e); }

            // --- COMANDOS ADMIN ---
            if (isAdmin && (text === 'dolar' || text === 'bcv' || text === 'paralelo')) {
                await actualizarDolar();
                return await safeSendMessage(from, { text: `💵 BCV: ${dolarInfo.bcv}\n📈 Paralelo: ${dolarInfo.paralelo}` });
            }

            // --- SALUDO Y MENÚ ---
            if (['menu', 'hola', 'buen dia', 'buenos dias'].includes(text)) {
                const nombreUsuario = vendedor ? vendedor.nombre : pushName;
                return await safeSendMessage(from, { text: `¡Hola *${nombreUsuario}*! Es un gusto saludarte. 😊\n\n¿En qué podemos ayudarte hoy? Por favor, indícanos qué servicio necesitas o consulta nuestro menú a continuación:\n\n${MENU_TEXT}` });
            }
            
            // --- FALLBACK ---
            const conversationalShorts = ['si', 'no', 'ok', 'vale', 'gracias', 'ya', 'entendido', 'está bien', 'bueno', 'dale', 'está ok', 'claro'];
            if (conversationalShorts.includes(text)) return; 
            if (rawText.length > 500) return;

            await safeSendMessage(from, { text: "Lo siento, no logré entender tu solicitud. 😕 ¿Podrías darme más detalles o escribir *menu* para ver nuestras opciones?" });
        } catch (e) { console.log("[MSG] Error en handler de mensajes:", e.message); }
    });
}

// ===== SERVIDOR HTTP =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    const header = `<nav class="navbar navbar-dark bg-dark mb-4 shadow"><div class="container"><a class="navbar-brand fw-bold" href="/">ONE4CARS ADMIN</a></div></nav>`;
    const routename = parsedUrl.pathname;

    if (routename === '/cobranza') {
        const v = await cobranza.obtenerVendedores();
        const z = await cobranza.obtenerZonas();
        const d = await cobranza.obtenerListaDeudores(query);
        res.end(await cobranza.generarHTML(v, z, d, header, query));
    } else if (routename === '/marketing-panel') {
        const v = await marketingModulo.obtenerVendedores();
        const z = await marketingModulo.obtenerZonas();
        const c = await marketingModulo.obtenerClientesMarketing(query);
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(await marketingModulo.generarHTMLMarketing(c, v, z, header, query));
    } else if (routename === '/marketing-preview') {
        let sql = "SELECT id_cliente, nombres, celular FROM tab_clientes WHERE celular IS NOT NULL AND celular != '' ";
        const params = [];
        if (query.vendedor) { sql += " AND vendedor = ? "; params.push(query.vendedor); }
        if (query.zona) { sql += " AND zona = ? "; params.push(query.zona); }
        const [clientes] = await pool.execute(sql, params);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(clientes));
    } else if (routename === '/enviar-marketing' && req.method === 'POST') {
        if (!isBotReady()) return res.end("Bot no listo.");
        let b = ''; req.on('data', c => b += c);
        req.on('end', async () => {
            const data = JSON.parse(b);
            for (const id of data.clientes) {
                const [rows] = await pool.execute("SELECT * FROM tab_clientes WHERE id_cliente=?", [id]);
                if (rows[0]) {
                    const c = rows[0];
                    const jid = formatWhatsApp(c.celular);
                    try {
                        if (data.tipo === 'precios') {
                            await safeSendMessage(jid, { document: { url: PDF_URL_CATALOGO }, fileName: 'Catalogo-ONE4CARS.pdf', mimetype: 'application/pdf', caption: `¡Hola *${c.nombres}*! Catálogo actualizado.` });
                        } else if (data.tipo === 'promo') {
                            await safeSendMessage(jid, { text: data.mensaje });
                        }
                        await randomDelay();
                    } catch (e) {}
                }
            }
            res.end("OK");
        });
    } else if (routename === '/enviar-cobranza' && req.method === 'POST') {
        if (!isBotReady()) return res.end("Bot no listo.");
        let b = ''; req.on('data', c => b += c);
        req.on('end', async () => {
            const data = JSON.parse(b);
            for (const id_cliente of data.facturas) {
                const [facturas] = await pool.execute("SELECT f.nro_factura, f.total, f.abono_factura, f.fecha_reg, f.porcentaje, c.nombres, c.celular FROM tab_facturas f JOIN tab_clientes c ON f.id_cliente = c.id_cliente WHERE f.id_cliente = ? AND f.pagada = 'NO' AND f.anulado = 'no'", [id_cliente]);
                for (const f of facturas) {
                    const jid = formatWhatsApp(f.celular);
                    const saldoBs = (f.total - f.abono_factura) / (f.porcentaje || 1);
                    const msg = `Hola *${f.nombres}* 🚗, factura #${f.nro_factura} pendiente.\nSaldo: Bs. *${saldoBs.toLocaleString('es-VE')}*.\nPor favor gestione su pago.`;
                    await safeSendMessage(jid, { text: msg });
                    await randomDelay();
                }
            }
            res.end("OK");
        });
    } else if (routename === '/reset-sesion') {
        try {
            if (fs.existsSync('auth_info')) fs.rmSync('auth_info', { recursive: true, force: true });
            res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sesión borrada</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><meta http-equiv="refresh" content="5;url=/"></head><body class="bg-light"><div class="container mt-5 text-center"><div class="card shadow p-5 mx-auto" style="max-width:500px;border-radius:15px;"><h3>✅ Sesión borrada</h3><p class="mt-3">La carpeta <strong>auth_info</strong> se eliminó correctamente.</p><p>El bot mostrará un nuevo código QR en <strong>5 segundos</strong>.</p><a href="/" class="btn btn-primary mt-3">Ir al inicio</a></div></div></body></html>`);
        } catch (e) { res.end("Error al borrar sesión: " + e.message); }
    } else if (routename === '/notificador-estado') {
        const total = await notificador.obtenerFacturasNoNotificadasCount();
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><title>Notificador</title></head><body class="bg-light">${header}<div class="container mt-5"><div class="card shadow-lg p-4 mx-auto" style="max-width: 600px; border-radius: 15px;"><h3>📬 Notificador</h3><hr><p>Facturas pendientes: <strong>${total}</strong></p><p>Estado: ${isBotReady() ? '<span class="text-success">🟢 Online</span>' : '<span class="text-danger">🔴 Offline</span>'}</p><a href="/" class="btn btn-outline-secondary mt-3">Volver</a></div></div></body></html>`);
    } else if (routename === '/recordatorio-estado') {
        const facturas = await notificador.obtenerFacturasVencidas();
        const enviados = await notificador.obtenerRecordatoriosEnviados();
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><title>Recordatorios</title></head><body class="bg-light">${header}<div class="container mt-5"><div class="card shadow-lg p-4 mx-auto" style="max-width: 800px; border-radius: 15px;"><h3>📅 Recordatorios</h3><hr><table class="table table-sm"><thead><tr><th>Factura</th><th>Cliente</th><th>Días</th><th>Estado</th></tr></thead><tbody>${facturas.map(f => `<tr><td>${f.nro_factura}</td><td>${f.nombres}</td><td>${f.dias_vencida}</td><td>${(enviados[f.id_factura]) ? '✅' : '⏳'}</td></tr>`).join('')}</tbody></table><a href="/" class="btn btn-outline-secondary">Volver</a></div></div></body></html>`);
    } else {
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><meta http-equiv="refresh" content="30"><title>Admin ONE4CARS</title></head><body style="background-color: #f4f7f6;">${header}<div class="container text-center"><div class="card shadow-lg p-4 mx-auto" style="max-width: 500px; border-radius: 15px;"><h4 class="mb-3">Estado del Bot</h4><div class="my-4">${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" class="img-fluid rounded" style="max-width: 250px;">` : `<h2 class="text-success">${qrCodeData}</h2>`}</div><p>BCV: ${dolarInfo.bcv} | Paralelo: ${dolarInfo.paralelo}</p><div class="d-grid gap-2"><a href="/cobranza" class="btn btn-primary">PANEL DE COBRANZA</a><a href="/marketing-panel" class="btn btn-info text-white">PANEL DE MARKETING</a><a href="/notificador-estado" class="btn btn-secondary text-white">NOTIFICADOR</a><a href="/recordatorio-estado" class="btn btn-warning text-dark">RECORDATORIOS</a></div></div></div></body></html>`);
    }
});

server.listen(PORT, '0.0.0.0', async () => {
    await initDB();
    startBot();
    actualizarDolar();
    setInterval(actualizarDolar, 3600000);
});
