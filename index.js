const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cron = require('node-cron');
const mysql = require('mysql2/promise');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN ---
const genAI = new GoogleGenerativeAI("TU_API_KEY_AQUI"); // <--- REEMPLAZA ESTO
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let socketBot = null;
let qrCodeData = "";
const port = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Eres el asistente experto de ONE4CARS. Empresa de autopartes China-Venezuela.
REGLAS:
1. "Dólar caro": Somos importadores directos, precios competitivos.
2. "No tengo dinero": Empatía y pedir fecha de abono.
3. Si prometen fecha de pago, di "Entendido, lo agendo para seguimiento".`;

// --- WHATSAPP LOGIC ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    socketBot = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'error' }),
        printQRInTerminal: true 
    });
    
    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
            console.log("QR Generado satisfactoriamente.");
        }
        if (connection === 'open') {
            qrCodeData = "ONLINE";
            console.log('✅ CONECTADO EXITOSAMENTE');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();
        const numLimpio = from.split('@')[0].slice(-10);

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(`${SYSTEM_PROMPT}\nUsuario: ${body}`);
            const resp = result.response.text();
            await socketBot.sendMessage(from, { text: resp });

            if (resp.toLowerCase().includes("agendo") || body.match(/\b(lunes|martes|miercoles|jueves|viernes|pago el)\b/)) {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente, comentario_bot) SELECT id_cliente, 'COMPROMISO', ?, ? FROM tab_clientes WHERE celular LIKE ?", [body, resp, `%${numLimpio}%`]);
                await conn.end();
            }
        } catch (e) { console.error("Error IA:", e); }
    });
}

// --- SERVIDOR WEB ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    if (path === '/cobranza') {
        try {
            const data = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            let html = `<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="container mt-4">`;
            html += `<h2>Panel de Cobranza ONE4CARS</h2><table class="table table-striped"><thead><tr><th>Cliente</th><th>Factura</th><th>Saldo $</th></tr></thead><tbody>`;
            data.forEach(r => {
                html += `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>${parseFloat(r.saldo_pendiente || 0).toFixed(2)}</td></tr>`;
            });
            html += `</tbody></table></body></html>`;
            res.end(html);
        } catch (e) {
            res.end("Error cargando cobranza: " + e.message);
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData === "ONLINE") {
            res.end("<center><h1>ONE4CARS AI</h1><h2 style='color:green'>✅ CONECTADO</h2><br><a href='/cobranza'>Ver Cobranza</a></center>");
        } else if (qrCodeData) {
            res.end(`<center><h1>ONE4CARS AI</h1><p>Escanea para activar:</p><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.end("<center><h1>ONE4CARS AI</h1><p>Iniciando socket... Refresca en 5 segundos.</p></center>");
        }
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor ONE4CARS activo en puerto ${port}`);
    startBot();
});                                <td>${r.nro_factura}</td>
                                <td>${parseFloat(r.saldo_pendiente || 0).toFixed(2)}</td>
                                <td>${r.dias_transcurridos || 0}</td>
                            </tr>`;
            });

            html += `
                        </tbody>
                    </table>
                </body>
            </html>`;
            res.end(html);
        } catch (error) {
            console.error("Error en tabla:", error);
            res.writeHead(500);
            res.end("Error interno al cargar deudores");
        }
    } 
    // Ruta principal (donde sale el QR)
    else if (path === "" || path === "/") {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData === "ONLINE") {
            res.end("<center><h1>ONE4CARS AI</h1><h2 style='color:green'>✅ SISTEMA CONECTADO</h2><br><a href='/cobranza' class='btn btn-primary'>Ver Cobranza</a></center>");
        } else if (qrCodeData) {
            res.end(`<center><h1>ONE4CARS AI</h1><p>Escanea para activar:</p><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.end("<center><h1>ONE4CARS AI</h1><p>Iniciando... Refresca en 5 segundos.</p></center>");
        }
    } 
    // Si no es ninguna de las anteriores
    else {
        res.writeHead(404);
        res.end("Ruta no encontrada. Intenta con / o /cobranza");
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor ONE4CARS corriendo en puerto ${port}`);
    startBot();
});
