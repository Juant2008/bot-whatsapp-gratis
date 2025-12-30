const mysql = require('mysql2/promise');

async function ejecutarCobranza(sock) {
    console.log("🚀 Iniciando proceso de cobranza masiva...");
    
    let connection;
    try {
        // --- CONFIGURACIÓN DE TU MYSQL ---
        connection = await mysql.createConnection({
            host: 'https://www.one4cars.com', 
            user: 'juant200_one4car',
            password: 'Notieneclave1*',
            database: 'venezon'
        });

        // Consulta: Clientes con facturas pendientes de más de 30 días
        const [rows] = await connection.execute(
            `SELECT telefono, cliente, nro_factura, monto 
             FROM tab_facturas 
             WHERE estatus = 'pendiente' 
             AND DATEDIFF(CURDATE(), fecha_emision) > 30`
        );

        console.log(`📈 Se enviarán ${rows.length} recordatorios.`);

        for (const row of rows) {
            // Limpiamos el número: quitamos todo lo que no sea número
            let num = row.telefono.replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;

            const texto = `Hola *${row.cliente}* 🚗, te saludamos de *ONE4CARS*.\n\nNotamos que tu factura *${row.nro_factura}* por un monto de *${row.monto}* tiene más de 30 días vencida.\n\nPor favor, ayúdanos con el pago para mantener tu cuenta activa y evitar suspensiones de despacho.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.cliente} (${num})`);

            // PAUSA ANTI-BANEO: 30 segundos entre mensajes
            await new Promise(resolve => setTimeout(resolve, 30000));
        }

        return `Envío masivo finalizado. Total: ${rows.length}`;

    } catch (error) {
        console.error("❌ Error en base de datos MySQL:", error);
        throw error;
    } finally {
        if (connection) await connection.end();
    }
}

module.exports = { ejecutarCobranza };
