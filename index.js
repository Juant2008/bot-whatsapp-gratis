const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (ONE4CARS 2026) ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { temperature: 0.8, maxOutputTokens: 1000 } // Subimos temperatura para más fluidez humana
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- LÓGICA DE DÓLAR CON APIS ESPECÍFICAS Y CACHÉ ---
let _SESSION = {};

async function obtener_dolar_con_cache(type) {
    const cache_key = 'dolar_' + type;
    const cache_time_key = 'dolar_' + type + '_time';
    const cache_duration = 900; 

    if (_SESSION[cache_key] && _SESSION[cache_time_key] && (Math.floor(Date.now() / 1000) - _SESSION[cache_time_key] < cache_duration)) {
        return parseFloat(_SESSION[cache_key]);
    }

    const targetUrl = (type === 'oficial') 
        ? "https://api.dolarvzla.com/public/exchange-rate" 
        : "https://ve.dolarapi.com/v1/dolares/paralelo";

    const get_fallback = () => {
        return (_SESSION[cache_key] && !isNaN(_SESSION[cache_key])) ? parseFloat(_SESSION[cache_key]) : 0.0;
    };

    try {
        const res = await axios.get(targetUrl, { timeout: 7000 });
        const data = res.data;
        // Lógica según la estructura de las nuevas APIs
        let valor = (type === 'oficial') ? (data.current?.usd ?? 0.0) : (data.promedio ?? 0.0);

        if (valor <= 0) return get_fallback();

        _SESSION[cache_key] = parseFloat(valor);
        _SESSION[cache_time_key] = Math.floor(Date.now() / 1000);
        return parseFloat(valor);
    } catch (e) {
        return get_fallback();
    }
}

const MENU_COMPLETO = `🛠️ *MENÚ DE OPCIONES ONE4CARS* 🚗

1. 💰 *Medios de pago:* https://www.one4cars.com/medios_de_pago.php/
2. 📄 *Estado de cuenta:* https://www.one4cars.com/estado_de_cuenta.php/
3. 🏷️ *Lista de precios:* https://www.one4cars.com/lista_de_precios.php/
4. 🛒 *Tomar pedido:* https://www.one4cars.com/tomar_pedido.php/
5. 👥 *Mis clientes/Vendedores:* https://www.one4cars.com/mis_clientes.php/
6. 📝 *Afiliar cliente:* https://www.one4cars.com/afiliar_clientes.php/
7. 🔍 *Consulta de productos:* https://www.one4cars.com/consulta_productos.php/
8. 🚚 *Seguimiento Despacho:* https://www.one4cars.com/despacho.php/
9. 👨‍💼 *Asesor Humano:* Un operador revisará su requerimiento pronto.`;

// --- PROMPT CON LENGUAJE HUMANO VENEZOLANO ---
const knowledgeBase = (oficial, paralelo) => `Eres el Asistente de ONE4CARS. No eres un robot, eres un asesor de ventas venezolano, cordial, atento y "pilas".

CONTEXTO:
Importamos repuestos de China (tren delantero, rodamientos, etc.). 
Tasa BCV: Bs. ${oficial} | Paralelo: Bs. ${paralelo}.

REGLAS DE PERSONALIDAD:
- Saluda con naturalidad: "¡Hola! Un gusto saludarte", "¡Buen día! ¿Cómo va todo?", "A la orden por aquí".
- Habla como en Venezuela pero profesional: Usa "A su orden", "Dígame", "Con gusto".
- INDAGA: No solo respondas. Si alguien saluda, dile: "¿Qué repuesto estás buscando hoy para tu carro?" o "¿En qué te puedo apoyar con tu pedido?".
- SOSPECHA: Si preguntan por rodamientos o precios, dales el link de la lista pero pregúntales para qué carro buscan. 
- SIEMPRE ofrece ayuda antes de mandar el menú. Solo manda el menú completo si te lo piden o si el cliente está muy perdido.
- Si el usuario dice que es VENDEDOR, dile: "¡Excelente colega! Aquí tienes las herramientas para gestionar tus clientes y pedidos" (Opciones 4 y 5).

LINKS:
- Lista Precios: https://www.one4cars.com/lista_de_precios.php/
- Estado Cuenta: https://www.one4cars.com/estado_de_cuenta.php/`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS BOT", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') { qrCodeData = "ONLINE ✅"; }
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
        const textLow = text.toLowerCase();

        try {
            const dolarOficial = await obtener_dolar_con_cache('oficial');
            const dolarParalelo = await obtener_dolar_con_cache('paralelo');

            // Intercepción manual para comandos críticos
            if (textLow === "menu" || textLow === "menú" || textLow === "opciones") {
                return await sock.sendMessage(from, { text: `¡Claro que sí! Aquí tienes nuestro catálogo de opciones:\n\n${MENU_COMPLETO}` });
            }

            if (textLow.includes("tasa") || textLow.includes("bcv") || textLow.includes("dolar")) {
                return await sock.sendMessage(from, { text: `📈 *TASAS ACTUALIZADAS*\n\nOficial (BCV): Bs. ${dolarOficial}\nParalelo: Bs. ${dolarParalelo}\n\n¿Vas a realizar un pago o necesitas cotizar algún producto?` });
            }

            // Generación de respuesta con IA humana
            const result = await model.generateContent(`${knowledgeBase(dolarOficial, dolarParalelo)}\n\nCliente: ${text}\nAsistente (Cordial e indagador):`);
            const response = await result.response;
            await sock.sendMessage(from, { text: response.text() });

        } catch (e) {
            console.error("Error:", e);
            await sock.sendMessage(from, { text: "¡Hola! Un gusto saludarte. ¿En qué te puedo apoyar hoy con tus repuestos? Escribe *MENU* para ver todas las opciones." });
        }
    });
}

// --- SERVIDOR HTTP COMPLETO (Panel de Cobranza + Header PHP) ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Gestión 2026</span>
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
                        .table-container { max-height: 600px; overflow-y: auto; }
                        thead th { position: sticky; top: 0; background: #212529; color: white; z-index: 10; }
                    </style>
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container-fluid px-4">
                        <div class="card shadow mb-4 border-0">
                            <div class="card-body">
                                <h4 class="fw-bold mb-3">Panel de Cobranza</h4>
                                <form class="row g-3">
                                    <div class="col-md-3">
                                        <label class="small fw-bold">Vendedor</label>
                                        <select name="vendedor" class="form-select">
                                            <option value="">-- Todos --</option>
                                            ${v.map(i => `<option value="${i.nombre}" ${parsedUrl.query.vendedor === i.nombre ? 'selected' : ''}>${i.nombre}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="small fw-bold">Zona</label>
                                        <select name="zona" class="form-select">
                                            <option value="">-- Todas --</option>
                                            ${z.map(i => `<option value="${i.zona}" ${parsedUrl.query.zona === i.zona ? 'selected' : ''}>${i.zona}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-2">
                                        <label class="small fw-bold">Días</label>
                                        <input type="number" name="dias" class="form-control" value="${parsedUrl.query.dias || 0}">
                                    </div>
                                    <div class="col-md-4 d-flex align-items-end">
                                        <button class="btn btn-primary w-100 fw-bold">FILTRAR REGISTROS</button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <div class="card shadow border-0">
                            <div class="table-container">
                                <table class="table table-hover align-middle mb-0">
                                    <thead class="table-dark">
                                        <tr class="text-center">
                                            <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                            <th class="text-start">Cliente</th>
                                            <th>Factura</th>
                                            <th>Monto $</th>
                                            <th>Monto Bs.</th>
                                            <th>Días</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${d.map(i => `
                                            <tr class="text-center">
                                                <td><input type="checkbox" class="rowCheck form-check-input" value='${JSON.stringify(i)}'></td>
                                                <td class="text-start"><strong>${i.nombres}</strong></td>
                                                <td><span class="badge bg-light text-dark border">${i.nro_factura}</span></td>
                                                <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                                <td class="text-primary fw-bold">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                                <td><span class="badge ${i.dias_transcurridos > 15 ? 'bg-danger' : 'bg-success'}">${i.dias_transcurridos}</span></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="card-footer bg-white p-3">
                                <button onclick="enviar()" id="btnSend" class="btn btn-success btn-lg w-100 fw-bold shadow">🚀 ENVIAR RECORDATORIOS POR WHATSAPP</button>
                            </div>
                        </div>
                    </div>
                    <script>
                        document.getElementById('selectAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        };
                        async function enviar() {
                            const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(selected.length === 0) return alert('Seleccione clientes');
                            const btn = document.getElementById('btnSend');
                            btn.disabled = true; btn.innerText = 'ENVIANDO...';
                            await fetch('/enviar-cobranza', { 
                                method:'POST', 
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({facturas:selected}) 
                            });
                            alert('Envío masivo iniciado correctamente.');
                            btn.disabled = false; btn.innerText = '🚀 ENVIAR RECORDATORIOS POR WHATSAPP';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) { res.end(`Error: ${e.message}`); }
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
            <head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body class="bg-light text-center">
                ${header}
                <div class="container py-5">
                    <div class="card shadow p-4 mx-auto border-0" style="max-width: 450px;">
                        <h4 class="mb-4 fw-bold">Estatus ONE4CARS</h4>
                        ${qrCodeData.startsWith('data') 
                            ? `<img src="${qrCodeData}" class="img-fluid border rounded shadow-sm">` 
                            : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "INICIANDO..."}</div>`
                        }
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2 shadow">PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
