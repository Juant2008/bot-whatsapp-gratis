// --- START OF FILE cobranza.js ---

const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// --- FUNCIONES ORIGINALES DE COBRANZA ---

async function obtenerVendedores() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { 
        console.error("Error obteniendo vendedores:", e);
        return []; 
    } finally { 
        if (conn) await conn.end(); 
    }
}

async function obtenerZonas() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { 
        console.error("Error obteniendo zonas:", e);
        return []; 
    } finally { 
        if (conn) await conn.end(); 
    }
}

async function obtenerListaDeudores(filtros = {}) {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 0;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        // Tu lógica original compleja de SQL
        let sql = `
            SELECT celular, nombres, nro_factura, total, abono_factura,
                   (total - abono_factura) AS saldo_pendiente, ((total - abono_factura) / NULLIF(porcentaje, 0)) AS saldo_bolivares,
                   fecha_reg, vendedor as vendedor_nom, zona as zona_nom,
                   DATEDIFF(CURDATE(), fecha_reg) AS dias_transcurridos
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND (anulado IS NULL OR anulado <> 'si')
            AND (total - abono_factura) > 0 
            AND DATEDIFF(CURDATE(), fecha_reg) >= ?
        `;
        const params = [minDias];
        if (vendedor) { sql += ` AND vendedor = ?`; params.push(vendedor); }
        if (zona) { sql += ` AND zona = ?`; params.push(zona); }
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await conn.execute(sql, params);
        return rows;
    } catch (e) { 
        console.error("Error obteniendo deudores:", e);
        return []; 
    } finally { 
        if (conn) await conn.end(); 
    }
}

async function ejecutarEnvioMasivo(sock, facturas) {
    // Lista de clientes que NO deben ver precios en bolívares (Lógica original)
    const excluirBolivares = ['CLIENTE_1', 'CLIENTE_2']; 

    for (const row of facturas) {
        try {
            // 1. Limpiar espacios y caracteres no numéricos
            let num = row.celular.toString().replace(/\s/g, '').replace(/\D/g, '');
            
            // 2. Corregir formato: si empieza con 580412... -> 58412...
            if (num.startsWith('580')) {
                num = '58' + num.substring(3);
            }
            
            // 3. Asegurar prefijo internacional
            if (!num.startsWith('58')) num = '58' + num;

            const jid = `${num}@s.whatsapp.net`;

            // Lógica de privacidad para el saldo original
            let saldoTexto = "";
            if (excluirBolivares.includes(row.nombres)) {
                saldoTexto = `Saldo: *Ref. ${parseFloat(row.saldo_pendiente).toFixed(2)}*`;
            } else {
                saldoTexto = `Saldo: *$. ${parseFloat(row.saldo_bolivares).toFixed(2)}*`;
            }

            const texto = `Hola *${row.nombres}* 🚗, de *ONE4CARS*.\n\nLe Notificamos que su Nota está pendiente:\n\nFactura: *${row.nro_factura}*\n${saldoTexto}\nPresenta: *${row.dias_transcurridos} días vencidos*\n\nPor favor, gestione su pago a la brevedad. Cuide su crédito, es valioso.`;
            
            // Verificación del socket
            if (sock && sock.sendMessage) {
                await sock.sendMessage(jid, { text: texto });
                console.log(`✅ Recordatorio enviado a: ${num}`);
            } else {
                console.log("❌ Socket no listo, saltando envío.");
            }

            // Espera de 10 segundos entre mensajes (Original)
            await new Promise(r => setTimeout(r, 10000));
        } catch (e) {
            console.log("Error enviando a una fila", e);
        }
    }
}

// --- NUEVA FUNCIONALIDAD: IA AGENT ---

async function registrarAgenda(jid, nombre_whatsapp, evento, r_cliente, r_bot, fecha_comp) {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        
        // Limpieza del número para buscar en DB (sin @s.whatsapp.net y sin prefijo pais si es necesario)
        // Buscamos con LIKE '%numero%' para ser flexibles con el 58 o 0412
        let telefonoRaw = jid.split('@')[0];
        let telefonoBusqueda = telefonoRaw.slice(-7); // Últimos 7 dígitos

        let id_cliente_final = 0;
        let id_vendedor_final = 0;

        // 1. BUSCAR EN TABLA CLIENTES (Prioridad)
        const [clientes] = await conn.execute(
            'SELECT id_cliente, id_vendedor FROM tab_cliente WHERE celular LIKE ? LIMIT 1', 
            [`%${telefonoBusqueda}%`]
        );

        if (clientes.length > 0) {
            id_cliente_final = clientes[0].id_cliente;
            id_vendedor_final = clientes[0].id_vendedor;
        } else {
            // 2. SI NO ES CLIENTE, VERIFICAR SI ES VENDEDOR
            const [vendedores] = await conn.execute(
                'SELECT id_vendedor FROM tab_vendedores WHERE telefono LIKE ? OR celular LIKE ? LIMIT 1', 
                [`%${telefonoBusqueda}%`, `%${telefonoBusqueda}%`]
            );

            if (vendedores.length > 0) {
                id_vendedor_final = vendedores[0].id_vendedor;
                // Asignamos un ID de cliente genérico (ej. 1) porque el campo es NOT NULL
                // Asegúrate de tener un cliente con id=1 en tu base de datos o cambia este número
                id_cliente_final = 1; 
            } else {
                console.log(`⚠️ Número ${telefonoRaw} no reconocido en DB. No se puede agendar (Restricción FK).`);
                return; 
            }
        }

        // 3. INSERTAR (nro_factura NULL porque es una promesa general)
        const sql = `
            INSERT INTO tab_agenda_seguimiento 
            (id_cliente, id_vendedor, nro_factura, tipo_evento, fecha_compromiso, comentario_bot, respuesta_cliente, estatus)
            VALUES (?, ?, NULL, ?, ?, ?, ?, 'PENDIENTE')
        `;

        await conn.execute(sql, [
            id_cliente_final, 
            id_vendedor_final, 
            evento, 
            fecha_comp, 
            r_bot, 
            r_cliente
        ]);

        console.log(`✅ Compromiso agendado. Cliente ID: ${id_cliente_final}, Vendedor ID: ${id_vendedor_final}`);

    } catch (e) {
        console.error("❌ Error SQL en registrarAgenda:", e);
    } finally {
        if (conn) await conn.end();
    }
}

module.exports = { 
    obtenerListaDeudores, 
    ejecutarEnvioMasivo, 
    obtenerVendedores, 
    obtenerZonas, 
    registrarAgenda 
};
