const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

async function obtenerVendedores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_vendedor, nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_zona, zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerListaDeudores(filtros = {}) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 30;
        const idVendedor = filtros.id_vendedor || '';
        const idZona = filtros.id_zona || '';

        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.abono_factura,
                   (f.total - f.abono_factura) AS saldo_pendiente,
                   f.fecha_reg, v.nombre as vendedor_nom, z.zona as zona_nom,
                   DATEDIFF(CURDATE(), f.fecha_reg) AS dias_transcurridos
            FROM tab_facturas f
            LEFT JOIN tab_vendedores v ON f.vendedor = v.nombre
            LEFT JOIN tab_zonas z ON f.zona = z.zona
            WHERE f.pagada = 'NO' AND f.id_cliente <> 334 AND f.anulado <> 'si'
            AND (f.total - f.abono_factura) > 0 AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?
        `;
        const params = [minDias];
        if (idVendedor) { sql += ` AND v.id_vendedor = ?`; params.push(idVendedor); }
        if (idZona) { sql += ` AND z.id_zona = ?`; params.push(idZona); }
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) { return []; } finally { if (connection) await connection.end(); }
}

// FUNCIÓN CORREGIDA PARA BUSCAR SELECCIONADOS
async function obtenerDetalleFacturas(facturasIds) {
    if (!facturasIds || facturasIds.length === 0) return [];
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // Aseguramos que facturasIds sea un array de strings limpios
        const ids = facturasIds.map(id => id.toString());
        const placeholders = ids.map(() => '?').join(',');
        
        const [rows] = await connection.query(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) as saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) as dias_transcurridos 
            FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            ids
        );
        console.log(`🔎 Base de datos devolvió ${rows.length} registros de los seleccionados.`);
        return rows;
    } catch (e) { 
        console.error("❌ Error consultando detalles:", e.message); 
        return []; 
    } finally { if (connection) await connection.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`\n--- 🚀 INICIANDO ENVÍO A ${deudores.length} CLIENTES ---`);
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);

            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nEsta factura tiene ${row.dias_transcurridos} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado con éxito a: ${row.nombres}`);
            await new Promise(resolve => setTimeout(resolve, 20000));
        } catch (e) { console.error("❌ Error envío:", e.message); }
    }
    console.log("--- 🏁 FIN DEL PROCESO ---");
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas, obtenerDetalleFacturas };
