const mysql = require('mysql2/promise');

async function ejecutarCobranza(sock) {
    console.log("🚀 Iniciando proceso de cobranza masiva...");
    
// Configuración de conexión (Ajustada para MySQL)
const dbConfig = {
    host: 'one4cars.com', // Sin https://
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'venezon'
};

// Función 1: Solo obtiene la lista para mostrarla en pantalla
async function obtenerListaDeudores() {
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
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            `SELECT telefono, nombres, nro_factura, total 
            `SELECT celular, nombres, nro_factura, total, fecha_reg 
             FROM tab_facturas 
             WHERE pagada = 'NO' 
             AND DATEDIFF(CURDATE(), fecha_emision) > 300`
             AND DATEDIFF(CURDATE(), fecha_reg) > 30`
        );
        return rows;
    } catch (error) {
        console.error("❌ Error obteniendo lista:", error);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

        console.log(`📈 Se enviarán ${rows.length} recordatorios.`);

        for (const row of rows) {
            // Limpiamos el número: quitamos todo lo que no sea número
            let num = row.telefono.replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;

            const texto = `Hola *${row.cliente}* 🚗, te saludamos de *ONE4CARS*.\n\nNotamos que tu factura *${row.nro_factura}* por un monto de *${row.monto}* tiene más de 30 días vencida.\n\nPor favor, ayúdanos con el pago para mantener tu cuenta activa y evitar suspensiones de despacho.`;
// Función 2: Ejecuta el envío real de mensajes
async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`🚀 Iniciando envío masivo a ${deudores.length} clientes...`);
    
    for (const row of deudores) {
        try {
            // El campo celular ya tiene el 58, solo aseguramos el formato JID
            const jid = `${row.celular}@s.whatsapp.net`;
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nNotamos que tu factura *${row.nro_factura}* por un monto de *${row.total}* tiene más de 30 días vencida.\n\nPor favor, ayúdanos con el pago para mantener tu cuenta activa y evitar suspensiones de despacho.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.cliente} (${num})`);
            console.log(`✅ Mensaje enviado a ${row.nombres}`);

            // PAUSA ANTI-BANEO: 30 segundos entre mensajes
            // PAUSA ANTI-BANEO (30 segundos)
            await new Promise(resolve => setTimeout(resolve, 30000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}:`, e);
        }

        return `Envío masivo finalizado. Total: ${rows.length}`;

    } catch (error) {
        console.error("❌ Error en base de datos MySQL:", error);
        throw error;
    } finally {
        if (connection) await connection.end();
    }
    return true;
}

module.exports = { ejecutarCobranza };
module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
