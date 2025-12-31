const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

async function obtenerListaDeudores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const query = `
            SELECT celular, nombres, nro_factura, total, fecha_reg 
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND id_cliente <> 334 
            AND anulado <> 'si'
            AND DATEDIFF(CURDATE(), fecha_reg) >45
            ORDER BY fecha_reg ASC
        `;
        const [rows] = await connection.execute(query);
        return rows;
    } catch (error) {
        console.error("❌ ERROR MYSQL:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudoresSeleccionados) {
    console.log(`\n--- 🚀 INICIANDO ENVÍO A ${deudoresSeleccionados.length} CLIENTES ---`);
    
    for (const row of deudoresSeleccionados) {
        try {
            // 1. LIMPIEZA EXTREMA DEL NÚMERO
            // Quitamos +, espacios, guiones y aseguramos que solo queden números
            let numeroLimpio = row.celular.toString().replace(/\D/g, '');
            
            // Si por error no tiene el 58 al inicio, se lo ponemos (asumiendo Venezuela)
            if (!numeroLimpio.startsWith('58')) {
                numeroLimpio = '58' + numeroLimpio;
            }

            const jid = `${numeroLimpio}@s.whatsapp.net`;
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe informamos que su factura *${row.nro_factura}* por un monto de *${row.total}* se encuentra pendiente desde el ${row.fecha_reg}.\n\nPor favor, gestione su pago a la brevedad. Si ya realizó el pago, por favor envíenos el comprobante.`;

            // 2. ENVÍO REAL
            console.log(`📤 Intentando enviar a: ${row.nombres} (${numeroLimpio})...`);
            
            await sock.sendMessage(jid, { text: texto });
            
            console.log(`✅ MENSAJE ENTREGADO A WHATSAPP: ${row.nombres}`);

            // 3. ESPERA DE SEGURIDAD (Reducida a 15 seg para que no sea tan lento pero siga siendo seguro)
            if (deudoresSeleccionados.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
            
        } catch (e) {
            console.error(`❌ ERROR REAL enviando a ${row.nombres}:`, e.message);
        }
    }
    console.log("--- 🏁 FIN DEL PROCESO DE COBRANZA ---\n");
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
