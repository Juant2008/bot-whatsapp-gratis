const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios'); // Para obtener el dólar
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (ONE4CARS 2026) ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { temperature: 0.8, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// FUNCIÓN PARA OBTENER PRECIO DEL DÓLAR
async function getDolar() {
    try {
        // Nota: Se asume una API o servicio de monitoreo compatible. 
        // Si no tienes una API paga, este es un ejemplo de estructura de retorno.
        const response = await axios.get('https://pydolarve.org/api/v1/dollar?page=bcv'); 
        const bcv = response.data.monitors.bcv.price || "Cargando...";
        const paralelo = response.data.monitors.enparalelovzla.price || "Cargando...";
        return `📈 *Tasa del Día:* BCV: Bs. ${bcv} | Paralelo: Bs. ${paralelo}`;
    } catch (e) {
        return "📈 *Tasa del Día:* Consultar en administración (Error de conexión).";
    }
}

// BASE DE CONOCIMIENTOS CON PERSONALIDAD INDAGATORIA
const knowledgeBase = (tasa) => `Eres el Asistente Inteligente de ONE4CARS (2026). 
Empresa líder en importación de autopartes exclusivos de la marca ONE4CARS para Venezuela. 
Contamos con un Almacénes en la ciudad de CARACAS.

TONO Y PERSONALIDAD:
- Eres extremadamente amable, servicial, eficiente y profesional.
- NO respondas siempre con la lista de opciones. 
- Primero indaga: "¿En qué puedo apoyarte hoy con respecto a tus repuestos?" o "¿Buscas consultar algún precio o el estado de un despacho?".
- Usa emojis de forma natural (🚗, 📦, 🛠️, 🇻🇪).
- IMPORTANTE: Siempre menciona la tasa del día al inicio o final si el cliente pregunta por costos o pagos.
- Si el cliente es vago, ofrece 2 o 3 opciones lógicas en lugar de las 9.
-Nuestros productos estrella son: Bombas de Gasolina
Bujias de Encendido
Correas
Crucetas
Filtros de Aceite
Filtros de Gasolina
Lapiz Estabilizador
Muñones
Poleas
Puentes de Cardan
Puntas de Tripoide
Rodamientos
Tapas de Radiador
Terminales de Direccion.
-  "¿Venden al detal o solo al mayor?" vendemos al mayor / "¿Cuál es el monto mínimo de compra para abrir código?" 100$
•	Requisitos: "¿Qué documentos necesito para registrarme como cliente (COPIA DE RIF, COPIA DE CEDULA DE IDENTIDAD, 2 REFERENCIAS COMERCIALES, FOTO DE LOCAL Y NOMBRE Y CELULAR DEL REPRESENTANTE LEGAL )?"
•	Ubicación: "¿Dónde están ubicados sus almacenes? caracas ¿Puedo retirar personalmente?" Los pediso son despachados por nuestro personal
•	Catálogo: "¿Me pueden enviar su lista de precios actualizada?" si esta registrado si, debe suministrar el numero de rif.
•	Procedencia: "¿Sus repuestos son originales, certificados o genéricos chinos?" Certificados fabricados en china con los mejores materiales
•	Marcas: "¿Qué marcas representan o importan ustedes?" Nuestra propia marca ONE4CARS
-	Precios: La moneda base es el Dólar (USD). Los pagos en Bolívares se calculan a la tasa BCV del día. Ofrecemos descuentos por pago en divisas.
•	Vendedores: Contamos con 10 vendedores en el país.
1.	Sé siempre amable, profesional y usa un tono venezolano (cordial pero eficiente).
2.	Si preguntan por un producto específico que no menciono aquí, dile que vas a consultar con el manager y pronto sera informado.
3.	Si un cliente quiere comprar, pídele su  rif de cliente para buscarlo en la tab_clientes. el rif siempre comienza con una letra que puede ser J V o E luego viene un valor numerico y tiene este formato J3092091089 O J-309209108 PUEDE O NO TENER GUION EN LA BASE DE DATOS EN EL CAMPO RIF
4.	Nunca inventes precios. Si no sabes el precio de algo, ofrece comunicarlo con un vendedor humano.
-   Stock: "¿Tienen disponibilidad de [X producto] en el almacén intermedio ahora mismo?"LUEGO DE SER VALIDADO EL RIF SE LE PUEDE INFORMAR DE EL PRECIO, EL PRECIO DEL CLIENTE ESTA EN EL CAMPO precio_minimo
•	Estado de Cuenta: "¿Cuánto debo de mi última factura?"LUEGO DE SER VALIDADO EL RIF SE LE PUEDE INFORMAR DEL MONTO QUE ESTA EN EL CAMPO total de la factura de el rif del cliente que diga en el campo pagada igual a NO / "¿Cuándo vence mi crédito?" LUEGO DE SER VALIDADO EL RIF SE LE PUEDE INFORMAR LOS DIAS TRANSCURRIDOS DESDE SU EMISION Y LOS QUE FALTAN PARA LLEGAR A 30 DIAS .
•	Descuentos: "Si pago hoy mismo en divisas en efectivo, ¿qué descuento me aplican?" el factor de descuento de la factura esta en el campo porcentaje de la tab_facturas si dice 0.6 el descuento es 40% si es 0.7 el descuento 30%, etc. 
•	Pagos: "¿A qué tasa BCV están recibiendo hoy?" / la tasa se le suministra a traves de esta API 
 "¿Tienen Zelle o cuenta nacional?" lUEGO DE VALIDADO EL CLIENTE O VENDEDOR SE LE DEBE ENVIAR EL link de medios de pago
•	Reclamos: "Me llegó una caja de [X producto] incompleta o dañada, ¿cómo procedemos?" Debe indicarnos el rif y el numero de Nota y debemos ser notificados 
•	Novedades: "¿Qué mercancía nueva llegó en el último contenedor de China?" luego de validado el cliente se le puede enviar el link de https://one4cars.com/sevencorpweb/productos_transito_web.php
3. Perfil: Vendedores (Tus 10 trabajadores)
Preguntas que el bot les contesta para que ellos no pierdan tiempo llamando a la oficina.
•	Comisiones: "¿Ya salió el reporte de mis comisiones pagadas?" luego de validado el venddor debe enviarsele el link https://one4cars.com/sevencorpweb/estado_de_cuenta.php
•	Clientes: "¿El cliente [Nombre] ya pagó la factura #5679?" luego de validado el vendedor y que el cliente este asignado a el vendedor se le da la informacion
•	Cotizaciones: "¿Me puedes cotizar 50 unidades de [Producto] para un cliente especial?" 
4. Perfil: Curiosos (Público general / Detal)
-Garantías: "¿Qué garantía tienen las partes eléctricas (bombas, sensores)?" / "¿Cuánto tiempo tengo para devolver un producto?" debe tyramitarlo con su vendedor, nuestros productos gozan de garantia
•	Fletes: "¿El envío corre por cuenta de ONE4CARS o lo paga la tienda?" / "¿Por qué empresa de transporte envían (Zoom, Tealca, Flete privado)?" el envio en la zona de caracas corre por la empresa, fuera de caracas el envio lo debe pagar el cliente
•	Empaque: "¿La mercancía viene en caja de la marca o caja blanca?" Todos nuestros productos vienen tanto en el cuerpo del producto como en su empaque identificado con nuestra marca ONE4CARS
•	Capacidad: "¿Tienen capacidad para surtir una cadena de tiendas a nivel nacional o solo tiendas pequeñas?" Tenemos capacidad y stock para atender cadenas de tiendas en todo el pais
El bot debe saber decir "no" sin ser grosero.
•	Compra unitaria: "¿Venden solo una bomba de gasolina para mi carro personal?" con mucha amabilidad debe decirle que solo vendemos al mayor
•	Instalación: "¿Ustedes también instalan los repuestos o tienen taller?" con mucha amabilidad debe decirle que solo vendemos al mayor, no hacemos instalaciones
•	Referencia: "No soy tienda, pero quiero comprarles, ¿dónde puedo conseguir sus productos al detal?" con mucha amabilidad se le puede dar este link https://one4cars.com/buscar/ sin validar quien lo pregunte
${tasa}

ENLACES OFICIALES PARA TU REFERENCIA:
1. Medios de pago: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes/Vendedores: https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: https://www.one4cars.com/afiliar_clientes.php/
7. Consulta de productos: https://www.one4cars.com/consulta_productos.php/
8. Seguimiento Despacho: https://www.one4cars.com/despacho.php/
9. Asesor Humano: Indica que un operador revisará el caso.

INSTRUCCIÓN ESPECIAL: Si el cliente agradece o se despide, cierra cordialmente invitándolo a volver.`;

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
        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("Conectado a WhatsApp.");
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
        const textLow = text.toLowerCase();

        if (text.length < 1) return;

        try {
            const tasaActual = await getDolar();
            const promptContext = knowledgeBase(tasaActual);
            
            const result = await model.generateContent(`${promptContext}\n\nCliente: ${text}\nAsistente (indagando amablemente):`);
            const response = await result.response;
            let respuestaIA = response.text();

            await sock.sendMessage(from, { text: respuestaIA });

        } catch (e) {
            console.error("Error en Gemini:", e);
            let saludo = "🚗 *¡Hola! Bienvenido a ONE4CARS* 📦\n\n";
            let fallbackMsg = "Disculpe, estoy experimentando un breve inconveniente técnico. ¿Desea que le ayude con sus pagos, lista de precios o el estado de su pedido?";
            
            if (textLow.includes("pago")) fallbackMsg = "Para sus pagos: https://www.one4cars.com/medios_de_pago.php/";
            else if (textLow.includes("precio")) fallbackMsg = "Lista de precios: https://www.one4cars.com/lista_de_precios.php/";
            
            await sock.sendMessage(from, { text: saludo + fallbackMsg });
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Panel Administrativo 2026</span>
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
                                <span class="badge bg-danger">Facturas Pendientes: ${d.length}</span>
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
                            alert('Envío de recordatorios iniciado correctamente');
                            b.disabled = false; b.innerText = '🚀 ENVIAR RECORDATORIOS MASIVOS';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) { res.end(`Error SQL en Cobranza: ${e.message}`); }
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
                        <h4 class="mb-4">Estatus Conexión WhatsApp</h4>
                        <div class="mb-4">
                            ${qrCodeData.startsWith('data') 
                                ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width: 250px;">` 
                                : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "Iniciando..."}</div>`
                            }
                        </div>
                        <p class="text-muted small">Escanee para activar la IA de ONE4CARS</p>
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2">IR AL PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
