// --- START OF FILE index.js ---

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
// Asegúrate de tener la variable de entorno GEMINI_API_KEY
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyBKfvF9FOU84Bg_FDJeDZs5kSKu-lwnVwM");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

// --- PROMPT MAESTRO ---
const SYSTEM_INSTRUCTION = `
Eres el "Asistente Virtual Experto de ONE4CARS", la empresa líder importadora de autopartes desde China en Venezuela. Tu tono es profesional, amable, eficiente y con un lenguaje venezolano cordial.

### ESTRUCTURA DE NAVEGACIÓN (9 ENLACES OBLIGATORIOS)
Ofrece estos enlaces cuando sea pertinente:
1. 🏦 Medios de Pago: https://www.one4cars.com/medios_de_pago.php/
2. 📄 Estado de Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. 💰 Lista de Precios: https://www.one4cars.com/consulta_productos.php/ (Solo tras validar RIF)
4. 🛒 Tomar Pedido: https://www.one4cars.com/tomar_pedido.php/
5. 👥 Afiliar Cliente: Pedir RIF, Cédula, nombre, celular, referencias y foto negocio.
6. 👥 Mis Clientes: (Solo vendedores) Requiere validación.
7. ⚙️ Ficha Producto: Búsqueda dinámica.
8. 🚚 Despacho: https://one4cars.com/sevencorpweb/productos_transito_web.php
9. 👤 Asesor: Si solicita humano, notificar al vendedor asignado.

### REGLAS DE NEGOCIO
- VENTAS: Mayor ($100 min) y detal.
- DESCUENTO: 40% en divisas (Efectivo/Zelle). Tasa BCV.
- PRODUCTOS: Bombas Gasolina, Bujías, Correas, Crucetas, Filtros, Lápiz Estabilizador, Muñones, Poleas, Puentes Cardan, Puntas Tripoide, Rodamientos, Tapas Radiador, Terminales.

### PROTOCOLO TÉCNICO (CRÍTICO)
1. Si el cliente indica una FECHA DE PAGO (ej: "pago el viernes"), responde confirmando y FINALIZA tu respuesta con este JSON oculto:
   {"accion": "AGENDAR", "fecha": "YYYY-MM-DD", "evento": "Promesa de Pago"}
2. Si recibes una IMAGEN, analízala como repuesto automotriz.
3. No inventes precios.
`;

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;
const chatHistory = {}; // Memoria simple

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Se muestra en web
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
            qrCodeData = "BOT ONLINE CON GEMINI 🚀";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        // Ignorar estados
        if (from.includes('status@broadcast')) return;

        const pushName = msg.pushName || "Cliente";
        
        // Detectar si es Imagen o Texto
        const isImage = !!msg.message.imageMessage;
        const textBody = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "").trim();

        console.log(`Mensaje de ${from}: ${textBody} [Img: ${isImage}]`);

        try {
            // Historial
            if (!chatHistory[from]) chatHistory[from] = [];
            
            let promptParts = [];
            let fullPrompt = SYSTEM_INSTRUCTION + `\n\nHistorial:\n${chatHistory[from].join('\n')}\n\nUsuario dice: ${textBody}`;

            if (isImage) {
                // Descargar imagen
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'error' }), reuploadRequest: sock.updateMediaMessage });
                
                promptParts = [
                    { text: fullPrompt + "\n[INSTRUCCIÓN: Analiza la imagen del repuesto adjunto]" },
                    { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } }
                ];
            } else {
                promptParts = [{ text: fullPrompt }];
            }

            // Llamada a Gemini
            const result = await model.generateContent(promptParts);
            const responseText = result.response.text();

            // Procesar JSON oculto para Agenda
            let finalResponse = responseText;
            const jsonMatch = responseText.match(/\{"accion":\s*"AGENDAR".*?\}/s);

            if (jsonMatch) {
                try {
                    const dataAgenda = JSON.parse(jsonMatch[0]);
                    finalResponse = responseText.replace(jsonMatch[0], '').trim(); // Quitar JSON del texto visible
                    
                    // Guardar en MySQL usando la función relacional
                    await cobranza.registrarAgenda(
                        from, 
                        pushName, 
                        dataAgenda.evento, 
                        textBody, 
                        finalResponse, 
                        dataAgenda.fecha
                    );
                } catch (e) {
                    console.error("Error procesando JSON agenda:", e);
                }
            }

            // Enviar respuesta
            await sock.sendMessage(from, { text: finalResponse });

            // Actualizar historial
            chatHistory[from].push(`U: ${textBody}`);
            chatHistory[from].push(`B: ${finalResponse}`);
            if (chatHistory[from].length > 10) chatHistory[from].shift(); // Mantener ligero

        } catch (error) {
            console.error("Error bot:", error);
        }
    });
}

// --- SERVIDOR HTTP (Mantiene tu Panel de Cobranza intacto) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // Aquí inserto el HTML que tenías en tu archivo original (resumido por espacio, pero la lógica de datos está arriba)
        // Puedes pegar tu HTML original aquí abajo si lo prefieres
        res.write(`
            <html>
            <head>
                <title>ONE4CARS - Cobranza</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>body{background:#f8f9fa} .container{margin-top:20px; background:white; padding:20px; border-radius:10px; box-shadow:0 0 10px rgba(0,0,0,0.1)}</style>
            </head>
            <body>
                <div class="container">
                    <div class="d-flex justify-content-between align-items-center">
                        <h2>📊 Panel de Cobranza (AI Powered)</h2>
                    </div>
                    <hr>
                    <form method="GET" class="row g-2 mb-4">
                        <div class="col-md-3">
                            <label class="form-label">Vendedor</label>
                            <select name="vendedor" class="form-select form-select-sm">
                                <option value="">Todos</option>
                                ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Zona</label>
                            <select name="zona" class="form-select form-select-sm">
                                <option value="">Todas</option>
                                ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-md-2">
                            <label class="form-label">Días (Min)</label>
                            <input type="number" name="dias" class="form-control form-control-sm" value="${parsedUrl.query.dias || 0}">
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            <button type="submit" class="btn btn-primary btn-sm w-100">Filtrar</button>
                        </div>
                    </form>

                    <form id="formEnvio">
                        <div class="table-responsive" style="max-height: 500px; overflow-y: auto;">
                            <table class="table table-sm table-hover border">
                                <thead class="table-light sticky-top">
                                    <tr>
                                        <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                        <th>Cliente</th>
                                        <th>Factura</th>
                                        <th>Saldo</th>
                                        <th>Días</th>
                                        <th>Vendedor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deudores.map(d => `
                                        <tr>
                                            <td><input type="checkbox" name="f" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                            <td><small>${d.nombres}</small></td>
                                            <td><small>${d.nro_factura}</small></td>
                                            <td class="text-danger"><b>$${parseFloat(d.saldo_pendiente).toFixed(2)}</b></td>
                                            <td><span class="badge bg-warning text-dark">${d.dias_transcurridos}</span></td>
                                            <td><small>${d.vendedor_nom}</small></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button type="button" onclick="enviarMensajes()" id="btnEnviar" class="btn btn-success w-100 mt-3">🚀 Enviar WhatsApp Seleccionados</button>
                    </form>
                </div>
                <script>
                    document.getElementById('selectAll').onclick = function() {
                        const checks = document.querySelectorAll('.rowCheck');
                        for (const c of checks) c.checked = this.checked;
                    }
                    async function enviarMensajes() {
                        const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if (selected.length === 0) return alert('Seleccione facturas');
                        if (!confirm('¿Enviar mensajes a ' + selected.length + ' clientes?')) return;

                        const btn = document.getElementById('btnEnviar');
                        btn.disabled = true; btn.innerText = 'Enviando...';

                        try {
                            const res = await fetch('/enviar-cobranza', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ facturas: selected })
                            });
                            alert(await res.text());
                        } catch(e) { alert('Error en el envío'); }
                        btn.disabled = false; btn.innerText = '🚀 Enviar WhatsApp Seleccionados';
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
            try {
                const data = JSON.parse(body);
                if (socketBot && data.facturas) {
                    cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                    res.writeHead(200); res.end('Envío masivo iniciado...');
                } else {
                    res.writeHead(400); res.end('Bot no conectado');
                }
            } catch(e) { res.writeHead(500); res.end('Error interno'); }
        });
    }
    // Nueva ruta para enviar pagos puntuales
    else if (path === '/enviar-pago' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (socketBot && data.telefono && data.mensaje) {
                    let num = data.telefono.replace(/\D/g, '');
                    if (!num.startsWith('58')) num = '58' + num;
                    const jid = `${num}@s.whatsapp.net`;
                    await socketBot.sendMessage(jid, { text: data.mensaje });
                    res.writeHead(200); res.end('OK');
                } else {
                    res.writeHead(400); res.end('Faltan datos');
                }
            } catch(e) { res.writeHead(500); res.end('Error'); }
        });
    }
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:50px;"><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"><br><br><a href="/cobranza" style="color:blue">Ir a Cobranza</a></center>`);
        } else {
            res.write(`<center style="margin-top:100px;"><h1>${qrCodeData || "Iniciando..."}</h1><br><a href="/cobranza" style="padding:10px 20px; background:green; color:white; border-radius:5px; text-decoration:none;">ENTRAR A COBRANZA</a></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
