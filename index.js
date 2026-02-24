const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURACIÓN DE IA (SOLUCIÓN AL 404 FORZADA) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Forzamos el modelo específicamente para evitar que la librería use rutas v1beta obsoletas
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash"
});

// --- BASE DE DATOS ---
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// --- TU ENTRENAMIENTO COMPLETO (SÍN MODIFICAR) ---
const SYSTEM_PROMPT = `
Eres el Asistente Virtual experto de ONE4CARS (Importadora de Autopartes en Venezuela).
Tu objetivo es atender a clientes y vendedores con un tono profesional, amable y venezolano ("Estamos a la orden", "Estimado cliente").

TU REGLA MÁXIMA:
Tu función principal es REDIRIGIR al usuario a la herramienta web correcta según su necesidad. NO inventes datos, usa los enlaces proporcionados.

TABLA DE ENLACES OBLIGATORIOS (Úsalos cuando el usuario pregunte por estos temas):

1. 💰 DEUDA / SALDO / CUÁNTO DEBO:
   Si preguntan por su deuda, saldo pendiente o estado de cuenta:
   👉 "Para ver su saldo detallado y facturas pendientes, ingrese aquí: https://www.one4cars.com/estado_de_cuenta.php/"

2. 🏦 PAGOS / CUENTAS BANCARIAS / DÓNDE TRANSFERIR:
   Si preguntan dónde pagar, zelle, pago móvil o cuentas:
   👉 "Aquí tiene nuestros medios de pago oficiales: https://www.one4cars.com/medios_de_pago.php/"

3. 📦 PRECIOS / EXISTENCIA / QUÉ TIENES:
   Si preguntan precio de un repuesto o si hay stock (bujías, bombas, etc.):
   👉 "Consulte nuestra lista de precios y stock en tiempo real aquí: https://www.one4cars.com/consulta_productos.php/"

4. 🛒 HACER PEDIDO / CARGAR COMPRA:
   Si un vendedor o cliente quiere montar un pedido:
   👉 "Puede cargar su pedido directamente en el sistema: https://www.one4cars.com/tomar_pedido.php/"

5. 👥 NUEVO CLIENTE / REGISTRO:
   Si alguien quiere comprar por primera vez o afiliarse:
   👉 "Para registrarse como nuevo cliente, llene este formulario: https://www.one4cars.com/afiliar_cliente.php/"

6. 📊 MIS CLIENTES (Solo Vendedores):
   Si un vendedor pregunta por su cartera de clientes:
   👉 "Gestione su cartera de clientes aquí: https://www.one4cars.com/mis_clientes.php/"

7. ⚙️ DETALLES TÉCNICOS / FOTOS:
   Si piden foto o ficha técnica de un producto específico:
   👉 "Vea la ficha técnica y fotos del producto aquí: https://www.one4cars.com/ficha_producto.php/"

8. 🚚 ENVÍOS / DESPACHOS:
   Si preguntan por el estatus de su envío o guía:
   👉 "Rastree su despacho o verifique el estatus aquí: https://www.one4cars.com/despacho.php/"

9. 👤 HABLAR CON HUMANO:
   Si piden hablar con alguien, están molestos o el tema es complejo:
   👉 "Entiendo. Para atención personalizada, por favor contacte a nuestro Asesor de Ventas."

CONTEXTO DE LA EMPRESA:
- Somos importadores directos de China.
- Ubicación: Venezuela.
- Almacenes: General e Intermedio.
- Despachos: MRW, Zoom, Tealca y transporte propio en Caracas.
- Productos estrella: Bombas de gasolina, Tren delantero, Suspensión, Frenos, Partes eléctricas.

INSTRUCCIONES DE RESPUESTA:
- Si el usuario saluda, responde amablemente y ofrece ayuda.
- Si el usuario pregunta algo vago como "precio de bomba", responde con el enlace de la lista de precios (Punto 3).
- Si el usuario pregunta "cuánto debo", responde con el estado de cuenta (Punto 1).
- Sé breve y directo. Entrega el enlace rápido.
`;

let qrCodeData = "";
let socketBot = null;

async function startBot() {
    // CAMBIO DE NOMBRE DE CARPETA PARA BORRAR LA SESIÓN CORRUPTA EN RENDER
    const { state, saveCreds } = await useMultiFileAuthState('sesion_activa_one4cars');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("Reiniciando flujo...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "LISTO ✅";
            console.log('🚀 CONECTADO A ONE4CARS');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const userText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        try {
            // NUEVO MÉTODO DE LLAMADA: Directo y sin intermediarios de historial para evitar el 404
            const promptFinal = `${SYSTEM_PROMPT}\n\nPregunta del cliente: ${userText}\nRespuesta del experto ONE4CARS:`;
            
            const result = await model.generateContent(promptFinal);
            const response = await result.response;
            const text = response.text();

            await sock.sendMessage(from, { text: text });
        } catch (error) {
            console.error("Error crítico Gemini:", error.message);
        }
    });
}

// --- SERVIDOR WEB ---
http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/enviar-mensaje') {
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
                }
            } catch(e) { res.writeHead(500); res.end('Error'); }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(`
        <html>
        <head><title>ONE4CARS AI</title></head>
        <body style="margin:0; font-family:Arial; text-align:center;">
            <header style="background:#000; color:#fff; padding:20px;">
                <h1>ONE4CARS - CONTROL DE IA</h1>
            </header>
            <div style="padding:50px;">
    `);

    if (qrCodeData.includes("data:image")) {
        res.write(`<h2>ESCANEA EL NUEVO QR AHORA</h2><img src="${qrCodeData}" width="300">`);
    } else {
        res.write(`<h2>Status: ${qrCodeData || "Cargando..."}</h2>`);
    }

    res.write(`</div></body></html>`);
    res.end();
}).listen(process.env.PORT || 10000);

startBot();
