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

        // Corregido: Join por campos de texto (vendedor y zona)
        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.fecha_reg, 
                   f.vendedor as vendedor_nom, f.zona as zona_nom,
                   DATEDIFF(CURDATE(), f.fecha_reg) AS dias_transcurridos
            FROM tab_facturas f
            LEFT JOIN tab_vendedores v ON f.vendedor = v.nombre
            LEFT JOIN tab_zonas z ON f.zona = z.zona
            WHERE f.pagada = 'NO' 
            AND f.id_cliente <> 334 
            AND f.anulado <> 'si'
            AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?
        `;

        const params = [minDias];

        // Filtramos usando las tablas unidas
        if (idVendedor) {
            sql += ` AND v.id_vendedor = ?`;
            params.push(idVendedor);
        }
        if (idZona) {
            sql += ` AND z.id_zona = ?`;
            params.push(idZona);
        }

        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await connection.execute(sql, params);
        console.log(`📊 Filtro aplicado: ${minDias} días. Encontrados: ${rows.length}`);
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
            let numeroLimpio = row.celular.toString().replace(/\D/g, '');
            if (!numeroLimpio.startsWith('58')) numeroLimpio = '58' + numeroLimpio;
            
            const jid = `${numeroLimpio}@s.whatsapp.net`;
            const fechaValida = new Date(row.fecha_reg).toISOString().split('T')[0];

            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un saldo de *${row.total}* con *${row.dias_transcurridos} días* de vencimiento (emitida el ${fechaValida}).\n\nPor favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres}`);

            await new Promise(resolve => setTimeout(resolve, 20000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}:`, e.message);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas };
