const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (Actualizado para ONE4CARS 2026) ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Configuración del modelo:
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { 
        temperature: 0.7, 
        maxOutputTokens: 1000 
    }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- FUNCIÓN AUXILIAR PARA CONSULTAR API DE DÓLAR ---
function obtenerTasa(apiUrl) {
    return new Promise((resolve) => {
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.promedio || null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

// --- GENERADOR DE PROMPT DINÁMICO ---
// SE AGREGÓ: El parámetro nombreUsuario
async function construirInstrucciones(nombreUsuario = "Estimado cliente") {
    const tasaOficial = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/oficial');
    const tasaParalelo = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/paralelo');

    const txtOficial = tasaOficial ? `Bs. ${tasaOficial}` : "No disponible";
    const txtParalelo = tasaParalelo ? `Bs. ${tasaParalelo}` : "No disponible";
    const fecha = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    return `
    ROL: Eres ONE4-Bot, el asistente experto de ONE4CARS, empresa importadora de autopartes desde China a Venezuela.
    FECHA Y HORA ACTUAL: ${fecha}
    
    --- DATOS DEL USUARIO (MUY IMPORTANTE) ---
    NOMBRE DEL CLIENTE: ${nombreUsuario}. 
    Dirígete a esta persona por su nombre. Trátalo de manera cálida, cercana y muy humana (como si fueras una persona real conversando amigablemente por WhatsApp, no un robot automatizado).

    --- DATOS ECONÓMICOS EN TIEMPO REAL (INFORMATIVO) ---
    Dólar Oficial (BCV): ${txtOficial}
    Dólar Paralelo: ${txtParalelo}
    (Si el cliente pregunta por el precio del dólar, informa estos valores con exactitud).

    --- 1. IDENTIDAD Y TONO (PERSONALIDAD VENEZOLANA) ---
    - Tu tono es profesional, servicial y genuinamente venezolano.
    - Bienvenida Dinámica: En el primer contacto, genera saludos aleatorios y cordiales usando el nombre del cliente. Interésate por su bienestar.
      Ejemplos: "¡Hola ${nombreUsuario}! ¿Cómo está todo, estimado? Espero que tenga un excelente día." o "¡Buen día ${nombreUsuario}! Un gusto saludarte, ¿cómo va la jornada por allá?".
    - Lenguaje: Usa términos como "A su orden", "Estamos a su disposición", "Un gusto".

    --- 2. DETECCIÓN DE INTENCIONES Y ENLACES OFICIALES ---
    Si detectas estas intenciones, responde humanamente y entrega EL ENLACE EXACTO:
    1. Medios de pago -> https://www.one4cars.com/medios_de_pago.php/
    2. Estado de cuenta -> https://www.one4cars.com/estado_de_cuenta.php/
    3. Lista de precios -> https://www.one4cars.com/lista_de_precios.php/
    4. Tomar pedido -> https://www.one4cars.com/tomar_pedido.php/
    5. Mis clientes/Vendedores -> https://www.one4cars.com/mis_clientes.php/
    6. Afiliar cliente -> https://www.one4cars.com/afiliar_clientes.php/
    7. Consulta de productos -> https://www.one4cars.com/consulta_productos.php/
    8. Seguimiento Despacho -> https://www.one4cars.com/despacho.php/
    9. Asesor Humano -> Indica que un operador revisará el caso pronto.

    --- 3. PAUTAS DE EXPERTO EN PRODUCTOS ONE4CARS ---
    - Validación de Identidad: Antes de dar información privada (saldos, stock detallado, precios), solicita el RIF o Cédula registrado.
    - Consultas de Stock: Si preguntan por un repuesto genérico (ej. "tienes bujías"), ACTÚA COMO EXPERTO y pregunta: Marca, Modelo y Año del vehículo.
    - Conocimiento Técnico: Explica la importancia de los repuestos usando tu base de conocimiento, pero siempre referenciando la marca ONE4CARS.
    - Almacenes: Almacén General = Bultos cerrados de China. Almacén Intermedio = Despacho inmediato al detal.

    --- 4. REGLAS DE OPERACIÓN Y SEGURIDAD ---
    - CERO INVENCIÓN: NO inventes precios. Si no tienes el dato, ofrece comunicar con un vendedor humano.
    - FILTRO MAYORISTA: Si el cliente parece ser detal ("tienes una pieza para mi carro"), explica amablemente que ONE4CARS vende exclusivamente al mayor (Mínimo $100) y ofrece el link de registro para tiendas (opción 6).
    - Asignación de Vendedores: Si alguien dice ser vendedor y da su cédula, indica que debes validar su identidad contra la base de datos interna (simulado).

    INSTRUCCIONES DE RESPUESTA:
    Responde al usuario basándote estrictamente en lo anterior. Sé amable, usa emojis (🚗, 📦, 🔧) y mantén la esencia venezolana.
    `;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), 
        browser:["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("Conectado exitosamente - ONE4-Bot Activo.");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        
        // SE AGREGÓ: Captura del nombre del perfil de WhatsApp del usuario
        const pushName = msg.pushName || "Estimado cliente"; 
        
        if (text.length < 1) return;

        try {
            if (!apiKey) throw new Error("Key no configurada");

            // SE AGREGÓ: Se le pasa el pushName a la función para personalizar el prompt
            const systemInstructions = await construirInstrucciones(pushName);

            // Enviamos el contexto + el mensaje del cliente a Gemini
            const chat = model.startChat({
                history:[
                    {
                        role: "user",
                        parts: [{ text: systemInstructions }],
                    },
                    {
                        role: "model",
                        parts:[{ text: `Entendido. Soy ONE4-Bot, listo para asistir a ${pushName} con un trato cálido, humano y experto en autopartes.` }],
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 800,
                },
            });

            const result = await chat.sendMessage(text);
            const response = result.response.text();
            
            await sock.sendMessage(from, { text: response });

        } catch (e) {
            console.error("Error en Gemini o API:", e);
            // RESPUESTA MANUAL DE RESPALDO (FALLBACK)
            const saludoError = `🚗 *ONE4-Bot:* Estimado ${pushName}, disculpe, estoy actualizando mis sistemas. 🔧\n\nPero aquí le dejo nuestros accesos directos:\n\n`;
            const menuFallback = `
1️⃣ *Pagos:* https://www.one4cars.com/medios_de_pago.php/
2️⃣ *Edo. Cuenta:* https://www.one4cars.com/estado_de_cuenta.php/
3️⃣ *Precios:* https://www.one4cars.com/lista_de_precios.php/
4️⃣ *Pedidos:* https://www.one4cars.com/tomar_pedido.php/
6️⃣ *Registro:* https://www.one4cars.com/afiliar_clientes.php/
8️⃣ *Despacho:* https://www.one4cars.com/despacho.php/

Estamos a su orden. Un asesor humano revisará su mensaje en breve.`;
            
            await sock.sendMessage(from, { text: saludoError + menuFallback });
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // HEADER PHP COMPLETO
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Panel Administrativo</span>
                </div>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none small">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm fw-bold">COBRANZA</a>
                </nav>
            </div>
        </header>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <html>
                <head>
                    <title>Cobranza - ONE4CARS</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .table-container { max-height: 600px; overflow-y: auto; border: 1px solid #ddd; }
                        thead th { position: sticky; top: 0; background: #212529; color: white; z-index: 10; }
                    </style>
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container bg-white shadow p-4 rounded-3">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <h3>Gestión de Cobranza</h3>
                            <div class="text-end">
                                <span class="badge bg-danger">Facturas: ${d.length}</span>
                            </div>
                        </div>

                        <form class="row g-2 mb-4 p-3 bg-light border rounded">
                            <div class="col-md-3">
                                <label class="small fw-bold">Vendedor</label>
                                <select name="vendedor" class="form-select form-select-sm">
                                    <option value="">-- Todos --</option>
                                    ${v.map(i => `<option value="${i.nombre}">${i.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="small fw-bold">Zona</label>
                                <select name="zona" class="form-select form-select-sm">
                                    <option value="">-- Todas --</option>
                                    ${z.map(i => `<option value="${i.zona}">${i.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label class="small fw-bold">Días Vencidos</label>
                                <input type="number" name="dias" class="form-control form-control-sm" value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-4 d-flex align-items-end">
                                <button class="btn btn-dark btn-sm w-100 fw-bold">FILTRAR LISTADO</button>
                            </div>
                        </form>

                        <div class="table-container rounded">
                            <table class="table table-hover table-sm text-center align-middle m-0">
                                <thead>
                                    <tr>
                                        <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                        <th class="text-start">Cliente</th>
                                        <th>Factura</th>
                                        <th>Saldo $</th>
                                        <th>Saldo Bs.</th>
                                        <th>Días</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${d.map(i => `
                                        <tr>
                                            <td><input type="checkbox" class="rowCheck form-check-input" value='${JSON.stringify(i)}'></td>
                                            <td class="text-start"><small>${i.nombres}</small></td>
                                            <td><span class="badge bg-light text-dark border">${i.nro_factura}</span></td>
                                            <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                            <td class="text-primary fw-bold">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                            <td><span class="badge ${i.dias_transcurridos > 15 ? 'bg-danger' : 'bg-success'}">${i.dias_transcurridos}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button onclick="enviar()" id="btnSend" class="btn btn-success w-100 py-3 mt-3 fw-bold shadow">🚀 ENVIAR RECORDATORIOS MASIVOS</button>
                    </div>

                    <script>
                        document.getElementById('selectAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        }
                        async function enviar() {
                            const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(selected.length === 0) return alert('Seleccione clientes');
                            const b = document.getElementById('btnSend');
                            b.disabled = true; b.innerText = 'ENVIANDO...';
                            await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:selected}) });
                            alert('Envío iniciado correctamente');
                            b.disabled = false; b.innerText = '🚀 ENVIAR RECORDATORIOS MASIVOS';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) { res.end(`Error SQL: ${e.message}`); }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => { 
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); 
            res.end("OK"); 
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <html>
            <head>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            </head>
            <body class="bg-light text-center">
                ${header}
                <div class="container py-5">
                    <div class="card shadow p-4 mx-auto" style="max-width: 450px;">
                        <h4 class="mb-4">Status de Conexión</h4>
                        <div class="mb-4">
                            ${qrCodeData.startsWith('data') 
                                ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width: 250px;">` 
                                : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "Iniciando..."}</div>`
                            }
                        </div>
                        <p class="text-muted small">Escanee el código para activar el servicio de ONE4CARS</p>
                        <p class="text-primary fw-bold small">Bot Dinámico con IA + API Dólar Activo</p>
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2">IR AL PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
