const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURACIÓN GEMINI ---
// ⚠️ PEGA TU API KEY AQUÍ ABAJO ENTRE LAS COMILLAS
const GEN_AI_KEY = "PEGA_TU_API_KEY_DE_GOOGLE_AQUI"; 
const genAI = new GoogleGenerativeAI(GEN_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
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
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // --- 1. RESPUESTAS RÁPIDAS (LINKS) ---
        // Mantenemos esto manual para asegurar que los links sean exactos y rápidos.
        const respuestasFijas = {
            'medios de pago': 'Estimado cliente, acceda al siguiente enlace para ver nuestras formas de pago actualizadas:\n\n🔗 https://www.one4cars.com/medios_de_pago.php/',
            'estado de cuenta': 'Estimado cliente, puede consultar su estado de cuenta detallado en el siguiente link:\n\n🔗 https://www.one4cars.com/estado_de_cuenta.php/',
            'lista de precio': 'Estimado cliente, descargue nuestra lista de precios más reciente aquí:\n\n🔗 https://www.one4cars.com/lista_de_precios.php/',
            'tomar pedido': 'Estimado cliente, inicie la carga de su pedido de forma rápida aquí:\n\n🔗 https://www.one4cars.com/tomar_pedido.php/',
            'mis cliente': 'Estimado, gestione su cartera de clientes en el siguiente apartado:\n\n🔗 https://www.one4cars.com/mis_clientes.php/',
            'afiliar cliente': 'Estimado, para afiliar nuevos clientes por favor ingrese al siguiente link:\n\n🔗 https://www.one4cars.com/afiliar_clientes.php/',
            'ficha producto': 'Estimado cliente, consulte las especificaciones y fichas técnicas aquí:\n\n🔗 https://www.one4cars.com/consulta_productos.php/',
            'despacho': 'Estimado cliente, realice el seguimiento en tiempo real de su despacho aquí:\n\n🔗 https://www.one4cars.com/despacho.php/',
            'asesor': 'Entendido. En un momento uno de nuestros asesores humanos revisará su caso y le contactará de forma manual. Gracias por su paciencia.'
        };

        const bodyLower = body.toLowerCase();
        let respondido = false;

        for (const [key, val] of Object.entries(respuestasFijas)) {
            if (bodyLower.includes(key)) {
                await sock.sendMessage(from, { text: "🚗 *SOPORTE ONE4CARS*\n________________________\n\n" + val });
                respondido = true;
                break;
            }
        }

        // --- 2. INTELIGENCIA ARTIFICIAL (GEMINI) ---
        // Si no es un comando fijo, le preguntamos a Gemini
        if (!respondido && body.length > 0) {
            try {
                // Indicamos que "escribiendo..."
                await sock.sendPresenceUpdate('composing', from);

                const prompt = `
                Actúa como el asistente virtual oficial de la empresa ONE4CARS (repuestos automotrices).
                Tu nombre es "Bot One4Cars".
                El usuario te ha escrito: "${body}".
                
                Instrucciones:
                1. Sé muy cordial, profesional y usa emojis de autos (🚗, 🔧).
                2. Si el usuario saluda o pide ayuda, preséntate brevemente y muestra SIEMPRE esta lista de opciones exacta (no inventes otras):
                   
                   *MENÚ PRINCIPAL:*
                   1. 🏦 Medios de Pago
                   2. 📄 Estado de Cuenta
                   3. 💰 Lista de Precios
                   4. 🛒 Tomar Pedido
                   5. 👥 Mis Clientes
                   6. ➕ Afiliar Cliente
                   7. ⚙️ Ficha Producto
                   8. 🚚 Despacho
                   9. 👤 Asesor

                   Dile al usuario que escriba el nombre de la opción que necesita.

                3. Si el usuario hace una pregunta general (ej: "¿qué venden?", "¿dónde están?"), responde la duda basándote en que vendemos repuestos automotrices, pero al final recuérdale que puede ver precios en la opción "Lista de Precios".
                4. Mantén la respuesta concisa.
                `;

                const result = await model.generateContent(prompt);
                const response = result.response;
                const text = response.text();

                await sock.sendMessage(from, { text: text });

            } catch (error) {
                console.error("Error con Gemini:", error);
                // Fallback por si falla la IA
                await sock.sendMessage(from, { text: "Hola, soy el asistente de ONE4CARS 🚗. En este momento estoy actualizando mis sistemas, pero por favor escribe qué necesitas (ej: 'Lista de precios' o 'Asesor')." });
            }
        }
    });
}

// --- SERVIDOR WEB PARA COBRANZA (SIN CAMBIOS) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // (Mismo HTML de tu código original, resumido aquí por espacio, pero asegúrate de mantenerlo)
        res.write(`
            <html>
            <head><title>ONE4CARS - Cobranza</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body style="padding:20px; background:#f8f9fa;">
                <div class="container bg-white p-4 rounded shadow">
                    <h2>📊 Panel de Cobranza</h2>
                    <form method="GET" class="row g-2 mb-4">
                        <div class="col-md-3">
                             <select name="vendedor" class="form-select"><option value="">Vendedor...</option>${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}</select>
                        </div>
                        <div class="col-md-3">
                             <select name="zona" class="form-select"><option value="">Zona...</option>${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}</select>
                        </div>
                        <div class="col-md-2"><input type="number" name="dias" class="form-control" placeholder="Días min" value="${parsedUrl.query.dias || 0}"></div>
                        <div class="col-md-2"><button type="submit" class="btn btn-primary w-100">Filtrar</button></div>
                    </form>
                    <form id="formEnvio">
                        <table class="table table-sm table-hover">
                            <thead><tr><th><input type="checkbox" id="selectAll"></th><th>Cliente</th><th>Factura</th><th>Saldo</th><th>Días</th></tr></thead>
                            <tbody>
                                ${deudores.map(d => `<tr><td><input type="checkbox" class="rowCheck" value='${JSON.stringify(d)}'></td><td>${d.nombres}</td><td>${d.nro_factura}</td><td class="text-danger">$${parseFloat(d.saldo_pendiente).toFixed(2)}</td><td>${d.dias_transcurridos}</td></tr>`).join('')}
                            </tbody>
                        </table>
                        <button type="button" onclick="enviarMensajes()" class="btn btn-success w-100">🚀 Enviar WhatsApp</button>
                    </form>
                </div>
                <script>
                    document.getElementById('selectAll').onclick = function() { document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked); }
                    async function enviarMensajes() {
                        const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if(selected.length===0) return alert('Seleccione al menos uno');
                        if(!confirm('Enviar a ' + selected.length + ' clientes?')) return;
                        await fetch('/enviar-cobranza', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({facturas: selected}) });
                        alert('Enviando...');
                    }
                </script>
            </body></html>
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
                res.writeHead(200); res.end('Procesando');
            } else { res.writeHead(400); res.end('Error'); }
        });
    }
    else if (path === '/enviar-pago' && req.method === 'POST') {
         let body = '';
         req.on('data', chunk => { body += chunk.toString(); });
         req.on('end', async () => {
             try {
                 const data = JSON.parse(body);
                 if (socketBot && data.telefono && data.mensaje) {
                     let num = data.telefono.replace(/\D/g, '');
                     if (!num.startsWith('58')) num = '58' + num;
                     await socketBot.sendMessage(`${num}@s.whatsapp.net`, { text: data.mensaje });
                     res.writeHead(200); res.end('OK');
                 } else { res.writeHead(400); res.end('Datos incompletos'); }
             } catch(e) { res.writeHead(500); res.end('Error'); }
         });
    }
    else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(qrCodeData.includes("data:image") ? `<img src="${qrCodeData}">` : `<h1>${qrCodeData || "Iniciando..."}</h1>`);
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
