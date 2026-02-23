require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN GEMINI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `
Eres el "Asistente Virtual Experto de ONE4CARS", la empresa líder importadora de autopartes desde China en Venezuela. Tu tono es profesional, amable, eficiente y con un lenguaje venezolano cordial ("Estimado cliente", "Estamos a su orden"). Eres un vendedor experto que conoce el catálogo de www.one4cars.com de memoria.

### ESTRUCTURA DE NAVEGACIÓN (9 ENLACES OBLIGATORIOS)
Debes ofrecer y manejar estos enlaces según el contexto del usuario:
1. 🏦 Medios de Pago: https://www.one4cars.com/medios_de_pago.php/
2. 📄 Estado de Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. 💰 Lista de Precios: https://www.one4cars.com/consulta_productos.php/ (Solo tras validar RIF y estatus activo)
4. 🛒 Tomar Pedido: https://www.one4cars.com/tomar_pedido.php/
5. 👥 Afiliar Cliente: Solicitar RIF, Cédula, nombre del titular, celular, dos referencias comerciales y foto del negocio.
6. 👥 Mis Clientes: (Exclusivo para vendedores) Requiere validación de cédula en tab_vendedores.
7. ⚙️ Ficha Producto: Búsqueda dinámica en tab_productos.
8. 🚚 Despacho: https://one4cars.com/sevencorpweb/productos_transito_web.php
9. 👤 Asesor: Si el cliente solicita visita o atención humana, enviar notificación al WhatsApp del vendedor asignado (id_vendedor en tab_vendedores).

### REGLAS DE NEGOCIO CRÍTICAS
- VENTAS: Mayor y detal. Mayorista requiere $100 mínimo para abrir código.
- PRODUCTOS ESTRELLA: Bombas de Gasolina, Bujías de Encendido, Correas, Crucetas, Filtros de Aceite, Filtros de Gasolina, Lápiz Estabilizador, Muñones, Poleas, Puentes de Cardan, Puntas de Tripoide, Rodamientos, Tapas de Radiador, Terminales de Direccion.
- LOGÍSTICA: Almacén en Caracas. Envíos en Caracas con logística propia. Interior del país por mensajería a elección y pago del cliente.
- FINANZAS: Moneda base USD. Pagos en Bs a tasa BCV del día. DESCUENTO ACTUAL: 40% por pago en divisas (Efectivo/Zelle).

### PROTOCOLO TÉCNICO
1. Si el cliente indica una FECHA DE PAGO (ej: "pago el viernes"), debes responder confirmando y además incluir al final de tu mensaje un bloque oculto JSON para el sistema: {"accion": "AGENDAR", "fecha": "YYYY-MM-DD", "evento": "Promesa de Pago"}.
2. Si recibes una IMAGEN, analízala como repuesto automotriz e indica qué pieza es según tu conocimiento experto.
3. No inventes precios. Si no sabes, deriva al asesor.

REGLA DE ORO: No inventar precios. Si no hay stock o el dato es incierto, remitir al Asesor Humano.
`;

// CORRECCIÓN DEL ERROR 404: Usar apiVersion v1 y pasar systemInstruction correctamente
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_INSTRUCTION }] }
}, { apiVersion: 'v1' });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;
const chatHistory = {}; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS AI", "Chrome", "5.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE 🚀";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const pushName = msg.pushName || "Cliente";
        const isImage = !!msg.message.imageMessage;
        const textBody = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "").trim();

        try {
            if (!chatHistory[from]) chatHistory[from] = [];
            
            let promptParts = [];
            let fullPrompt = `Historial:\n${chatHistory[from].join('\n')}\n\nUsuario: ${textBody}`;

            if (isImage) {
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'error' }), reuploadRequest: sock.updateMediaMessage });
                promptParts = [
                    { text: fullPrompt },
                    { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } }
                ];
            } else {
                promptParts = [{ text: fullPrompt }];
            }

            const result = await model.generateContent({ contents: [{ role: "user", parts: promptParts }] });
            const responseText = result.response.text();

            let finalResponse = responseText;
            const jsonMatch = responseText.match(/\{"accion":\s*"AGENDAR".*?\}/s);

            if (jsonMatch) {
                try {
                    const dataAgenda = JSON.parse(jsonMatch[0]);
                    finalResponse = responseText.replace(jsonMatch[0], '').trim(); 
                    await cobranza.registrarAgenda(from, pushName, dataAgenda.evento, textBody, finalResponse, dataAgenda.fecha);
                } catch (e) { console.error("Error JSON:", e); }
            }

            await sock.sendMessage(from, { text: finalResponse });
            chatHistory[from].push(`U: ${textBody}`, `B: ${finalResponse}`);
            if (chatHistory[from].length > 10) chatHistory[from].shift();

        } catch (error) {
            console.error("Error bot:", error);
        }
    });
}

// --- SERVIDOR HTTP COMPLETO (SIN SIMPLIFICAR) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`
            <html>
            <head>
                <title>ONE4CARS - Cobranza</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { background: #f4f7f6; font-family: sans-serif; }
                    .header-custom { background: #1a2a6c; color: white; padding: 15px; border-radius: 0 0 15px 15px; margin-bottom: 20px; }
                    .table-container { background: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    .sticky-top { top: -1px; background: white; z-index: 100; }
                </style>
            </head>
            <body>
                <div class="container-fluid">
                    <div class="header-custom shadow">
                        <h3>📊 Panel Control de Cobranza - ONE4CARS</h3>
                    </div>
                    
                    <div class="table-container mx-2">
                        <form method="GET" class="row g-3 mb-4 p-3 bg-light rounded border">
                            <div class="col-md-3">
                                <label class="form-label fw-bold">Vendedor</label>
                                <select name="vendedor" class="form-select shadow-sm">
                                    <option value="">Todos los Vendedores</option>
                                    ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label fw-bold">Zona</label>
                                <select name="zona" class="form-select shadow-sm">
                                    <option value="">Todas las Zonas</option>
                                    ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label class="form-label fw-bold">Días Vencidos</label>
                                <input type="number" name="dias" class="form-control shadow-sm" value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-2 d-flex align-items-end">
                                <button type="submit" class="btn btn-primary w-100 shadow-sm">🔍 Filtrar Datos</button>
                            </div>
                        </form>

                        <form id="formMasivo">
                            <div class="table-responsive" style="max-height: 600px;">
                                <table class="table table-hover align-middle">
                                    <thead class="table-dark sticky-top">
                                        <tr>
                                            <th><input type="checkbox" id="checkAll" class="form-check-input"></th>
                                            <th>Cliente / RIF</th>
                                            <th>Factura</th>
                                            <th>Saldo Pendiente</th>
                                            <th>Días</th>
                                            <th>Vendedor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${deudores.map(d => `
                                            <tr>
                                                <td><input type="checkbox" name="factura" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                                <td><b>${d.nombres}</b><br><small class="text-muted">${d.id_cliente}</small></td>
                                                <td>#${d.nro_factura}</td>
                                                <td class="text-danger fw-bold">$${parseFloat(d.saldo_pendiente).toFixed(2)}</td>
                                                <td><span class="badge ${d.dias_transcurridos > 30 ? 'bg-danger' : 'bg-warning text-dark'}">${d.dias_transcurridos} días</span></td>
                                                <td>${d.vendedor_nom}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="mt-4 p-3 bg-white border-top sticky-bottom">
                                <button type="button" onclick="enviarProceso()" id="btnSubmit" class="btn btn-success btn-lg shadow w-100">🚀 Enviar Notificaciones Masivas vía WhatsApp</button>
                            </div>
                        </form>
                    </div>
                </div>

                <script>
                    document.getElementById('checkAll').onclick = function() {
                        document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                    }

                    async function enviarProceso() {
                        const seleccionados = Array.from(document.querySelectorAll('.rowCheck:checked')).map(c => JSON.parse(c.value));
                        if(seleccionados.length === 0) return alert('Por favor, selecciona al menos una factura.');
                        
                        if(!confirm('¿Deseas enviar recordatorios automáticos a ' + seleccionados.length + ' clientes?')) return;
                        
                        const btn = document.getElementById('btnSubmit');
                        btn.disabled = true; btn.innerHTML = 'Enviando... Espere';

                        try {
                            const response = await fetch('/enviar-cobranza', {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({ facturas: seleccionados })
                            });
                            const resText = await response.text();
                            alert(resText);
                        } catch(e) { alert('Error en la comunicación con el bot.'); }
                        
                        btn.disabled = false; btn.innerHTML = '🚀 Enviar Notificaciones Masivas vía WhatsApp';
                    }
                </script>
            </body>
            </html>
        `);
        res.end();
    } 
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) {
                cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                res.writeHead(200); res.end('Proceso de envío iniciado correctamente.');
            } else {
                res.writeHead(400); res.end('El Bot no está conectado.');
            }
        });
    }
    else {
        // Pantalla Principal con QR
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(\`
            <center style="font-family:sans-serif; margin-top:50px;">
                <div style="max-width:400px; padding:20px; border:1px solid #ccc; border-radius:15px; background:#fff; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <img src="https://www.one4cars.com/img/logo.png" width="200"><br><br>
                    \${qrCodeData.includes("data:image") ? \`<img src="\${qrCodeData}" width="300"><h3>Escanea para conectar</h3>\` : \`<h2>\${qrCodeData}</h2>\`}
                    <br><br>
                    <a href="/cobranza" style="display:inline-block; padding:15px 30px; background:#1a2a6c; color:white; text-decoration:none; border-radius:10px; font-weight:bold;">IR AL PANEL DE COBRANZA</a>
                </div>
            </center>
        \`);
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
