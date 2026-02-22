// --- SERVIDOR WEB MEJORADO ---
const server = http.createServer(async (req, res) => {
    // Extraemos la ruta sin importar si tiene "/" al final
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname.replace(/\/+$/, ""); // Limpia la ruta

    console.log(`Petición recibida: ${path}`); // Esto saldrá en tus Logs de Render

    if (path === '/cobranza') {
        try {
            const data = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            
            let html = `
            <html>
                <head>
                    <title>Cobranza ONE4CARS</title>
                    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
                </head>
                <body class="container mt-4">
                    <h2 class="mb-4">Panel de Cobranza ONE4CARS</h2>
                    <table class="table table-hover table-bordered">
                        <thead class="table-dark">
                            <tr>
                                <th>Cliente</th>
                                <th>Factura</th>
                                <th>Saldo $</th>
                                <th>Días</th>
                            </tr>
                        </thead>
                        <tbody>`;
            
            data.forEach(r => {
                html += `
                            <tr>
                                <td>${r.nombres}</td>
                                <td>${r.nro_factura}</td>
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
