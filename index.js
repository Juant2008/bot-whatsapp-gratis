client.on('message_create', async (msg) => {
    // message_create permite que el bot también vea los mensajes que TÚ envías para que puedas probarlo tú mismo
    
    const mensajeUsuario = msg.body.toLowerCase().trim();
    console.log("Mensaje recibido:", mensajeUsuario); // Esto aparecerá en los logs de Render

    const saludos = [
        'Buen dia', 'Buen día', 'buendia', 'Buendia', 'BuendÍa','buen dia', 'buen día', 'buenos dias', 'buenos días', 'Buenos Días', 'Buenosdias', 'BuenosdÍas',
        'buenosdias', 'buenosdías', 'bns dias', 'bns días', 'buenas tardes', 'Buenas tardes', 'Buenas Tardes', 'bns tardes','buenas noches','Buenos Dias', 'BUENDIA'
    ];

    // Usamos .includes para que si el saludo está EN CUALQUIER PARTE del mensaje, el bot responda
    const esSaludo = saludos.some(s => mensajeUsuario.includes(s));

    if (esSaludo) {
        console.log("Enviando Menú Principal...");
        await client.sendMessage(msg.from, 
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Escribe la *frase* de la opción que necesitas:\n\n' +
            '🏦 *Medios de Pago*\n' +
            '📄 *Estado de Cuenta*\n' +
            '💰 *Lista de Precios*\n' +
            '🛒 *Tomar Pedido*\n' +
            '👥 *Mis Clientes*\n' +
            '⚙️ *Ficha Producto*\n' +
            '🚚 *Despacho*'
        );
    }

    // Respuestas a las opciones
    if (mensajeUsuario.includes('medios de pago')) {
        await client.sendMessage(msg.from, '🏦 *NUESTROS MEDIOS DE PAGO*\n\n🔸 *Zelle:* pagos@one4cars.com\n🔸 *Pago Móvil:* Banesco...');
    }
    
    // ... (puedes repetir este bloque para las otras opciones)
});
