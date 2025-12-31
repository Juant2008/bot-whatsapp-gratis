const mysql = require('mysql2/promise');

// Configuración de conexión (Ajustada para MySQL)
const dbConfig = {
    host: 'one4cars.com', // Sin https://
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// Función 1: Solo obtiene la lista para mostrarla en pantalla
async function obtenerListaDeudores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            `SELECT celular, nombres, nro_factura, total, fecha_reg 
             FROM tab_facturas 
             WHERE pagada = 'NO' and id_cliente <> 334 and anulado <> 'si'
             AND DATEDIFF(CURDATE(), fecha_reg) > 300`
        );
        return rows;
    } catch (error) {
        console.error("❌ Error obteniendo lista:", error);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

// Función 2: Ejecuta el envío real de mensajes
async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`🚀 Iniciando envío masivo a ${deudores.length} clientes...`);
    
    for (const row of deudores) {
        try {
            // El campo celular ya tiene el 58, solo aseguramos el formato JID
            const jid = `${row.celular}@s.whatsapp.net`;
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nNotamos que tu factura *${row.nro_factura}* por un monto de *${row.total}* tiene más de 30 días vencida.\n\nPor favor, ayúdanos con el pago para mantener tu cuenta activa y evitar suspensiones de despacho.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Mensaje enviado a ${row.nombres}`);

            // PAUSA ANTI-BANEO (30 segundos)
            await new Promise(resolve => setTimeout(resolve, 30000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}:`, e);
        }
    }
    return true;
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
