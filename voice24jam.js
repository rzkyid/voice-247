require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    EmbedBuilder,
} = require('discord.js');

const {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');

const konfigurasiVoiceGangDesa = {
    guildId: process.env.DISCORD_GUILD_ID,
    voiceChannelId: process.env.DISCORD_VOICE_CHANNEL_ID,
    logChannelId: process.env.DISCORD_LOG_CHANNEL_ID || null,
    reconnectDelay: 10_000,
    maksimalPercobaanReconnect: 10,
};

const clientVoiceGangDesa = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let prosesKoneksiVoiceGangDesa = false;
let timeoutReconnectVoiceGangDesa = null;
let jumlahReconnectVoiceGangDesa = 0;

async function kirimLogVoiceGangDesa(guild, deskripsi, warna = 'Blue') {
    try {
        if (!konfigurasiVoiceGangDesa.logChannelId) return;

        const channelLog = await guild.channels
            .fetch(konfigurasiVoiceGangDesa.logChannelId)
            .catch(() => null);

        if (!channelLog?.isTextBased()) return;

        const embedLog = new EmbedBuilder()
            .setColor(warna)
            .setDescription(deskripsi)
            .setTimestamp()
            .setFooter({
                text: 'GANG DESA | Voice 24/7',
                iconURL: guild.iconURL({ dynamic: true }) || undefined,
            });

        await channelLog.send({ embeds: [embedLog] }).catch(() => null);
    } catch (error) {
        console.error('[VOICE 24/7] Gagal mengirim log:', error);
    }
}

function jadwalkanReconnectVoiceGangDesa(guild, alasan) {
    if (timeoutReconnectVoiceGangDesa) return;

    jumlahReconnectVoiceGangDesa++;

    const pengaliDelay = Math.min(jumlahReconnectVoiceGangDesa, 6);
    const delayReconnect =
        konfigurasiVoiceGangDesa.reconnectDelay * pengaliDelay;

    console.warn(
        `[VOICE 24/7] Reconnect ke-${jumlahReconnectVoiceGangDesa} ` +
        `dalam ${delayReconnect / 1000} detik. Alasan: ${alasan}`
    );

    timeoutReconnectVoiceGangDesa = setTimeout(async () => {
        timeoutReconnectVoiceGangDesa = null;

        try {
            await masukVoiceGangDesa(guild);
        } catch (error) {
            console.error('[VOICE 24/7] Reconnect gagal:', error);

            jadwalkanReconnectVoiceGangDesa(
                guild,
                error.message || 'Kesalahan tidak diketahui'
            );
        }
    }, delayReconnect);
}

async function masukVoiceGangDesa(guild) {
    if (prosesKoneksiVoiceGangDesa) return;

    prosesKoneksiVoiceGangDesa = true;

    try {
        const voiceChannel = await guild.channels
            .fetch(konfigurasiVoiceGangDesa.voiceChannelId)
            .catch(() => null);

        if (
            !voiceChannel ||
            ![
                ChannelType.GuildVoice,
                ChannelType.GuildStageVoice,
            ].includes(voiceChannel.type)
        ) {
            throw new Error('Voice channel tidak ditemukan atau bukan channel voice.');
        }

        const botMember = guild.members.me;

        if (!botMember) {
            throw new Error('Data member bot belum tersedia.');
        }

        const izinBot = voiceChannel.permissionsFor(botMember);

        if (!izinBot?.has('ViewChannel')) {
            throw new Error('Bot tidak memiliki izin View Channel.');
        }

        if (!izinBot.has('Connect')) {
            throw new Error('Bot tidak memiliki izin Connect.');
        }

        const koneksiLama = getVoiceConnection(guild.id);

        if (koneksiLama) {
            const channelSekarang =
                koneksiLama.joinConfig.channelId;

            if (
                channelSekarang === voiceChannel.id &&
                koneksiLama.state.status === VoiceConnectionStatus.Ready
            ) {
                jumlahReconnectVoiceGangDesa = 0;
                return koneksiLama;
            }

            try {
                koneksiLama.destroy();
            } catch (error) {
                console.error(
                    '[VOICE 24/7] Gagal menghancurkan koneksi lama:',
                    error
                );
            }
        }

        const koneksiVoice = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,

            selfMute: false,

            selfDeaf: false,
        });

        pasangListenerKoneksiVoiceGangDesa(koneksiVoice, guild);

        await entersState(
            koneksiVoice,
            VoiceConnectionStatus.Ready,
            30_000
        );

        jumlahReconnectVoiceGangDesa = 0;

        console.log(
            `[VOICE 24/7] Berhasil masuk ke ${voiceChannel.name}`
        );

        await kirimLogVoiceGangDesa(
            guild,
            `✅ Bot berhasil terhubung ke voice channel ${voiceChannel}.`,
            'Green'
        );

        return koneksiVoice;
    } finally {
        prosesKoneksiVoiceGangDesa = false;
    }
}

function pasangListenerKoneksiVoiceGangDesa(koneksiVoice, guild) {
    koneksiVoice.on('error', error => {
        console.error('[VOICE 24/7] Voice connection error:', error);
    });

    koneksiVoice.on(
        VoiceConnectionStatus.Disconnected,
        async (statusLama, statusBaru) => {
            console.warn(
                `[VOICE 24/7] Koneksi terputus: ` +
                `${statusLama.status} → ${statusBaru.status}`
            );

            try {
                await Promise.race([
                    entersState(
                        koneksiVoice,
                        VoiceConnectionStatus.Signalling,
                        5_000
                    ),
                    entersState(
                        koneksiVoice,
                        VoiceConnectionStatus.Connecting,
                        5_000
                    ),
                ]);

                console.log(
                    '[VOICE 24/7] Discord sedang mencoba menyambungkan ulang.'
                );
            } catch {
                try {
                    koneksiVoice.destroy();
                } catch (error) {
                    console.error(
                        '[VOICE 24/7] Gagal menghancurkan koneksi:',
                        error
                    );
                }

                jadwalkanReconnectVoiceGangDesa(
                    guild,
                    'Status voice menjadi disconnected'
                );
            }
        }
    );

    koneksiVoice.on(VoiceConnectionStatus.Destroyed, () => {
        console.warn('[VOICE 24/7] Voice connection dihancurkan.');

        if (clientVoiceGangDesa.isReady()) {
            jadwalkanReconnectVoiceGangDesa(
                guild,
                'Voice connection destroyed'
            );
        }
    });

    koneksiVoice.on(VoiceConnectionStatus.Ready, () => {
        console.log('[VOICE 24/7] Voice connection siap digunakan.');
        jumlahReconnectVoiceGangDesa = 0;
    });
}

clientVoiceGangDesa.once('ready', async clientSiap => {
    console.log(
        `[VOICE 24/7] Login sebagai ${clientSiap.user.tag}`
    );

    const guild = await clientSiap.guilds
        .fetch(konfigurasiVoiceGangDesa.guildId)
        .catch(() => null);

    if (!guild) {
        console.error(
            '[VOICE 24/7] Server tidak ditemukan. Periksa DISCORD_GUILD_ID.'
        );
        return;
    }

    await masukVoiceGangDesa(guild).catch(async error => {
        console.error(
            '[VOICE 24/7] Gagal masuk voice saat startup:',
            error
        );

        await kirimLogVoiceGangDesa(
            guild,
            `❌ Gagal terhubung ke voice channel.\n` +
            `**Error:** \`${error.message}\``,
            'Red'
        );

        jadwalkanReconnectVoiceGangDesa(
            guild,
            error.message
        );
    });
});


setInterval(async () => {
    if (!clientVoiceGangDesa.isReady()) return;

    const guild = clientVoiceGangDesa.guilds.cache.get(
        konfigurasiVoiceGangDesa.guildId
    );

    if (!guild) return;

    const koneksiVoice = getVoiceConnection(guild.id);

    if (
        !koneksiVoice ||
        koneksiVoice.state.status === VoiceConnectionStatus.Destroyed
    ) {
        jadwalkanReconnectVoiceGangDesa(
            guild,
            'Pemeriksaan koneksi berkala'
        );
    }
}, 60_000);

async function hentikanBotVoiceGangDesa(sinyal) {
    console.log(`[VOICE 24/7] Menerima ${sinyal}. Mematikan bot...`);

    if (timeoutReconnectVoiceGangDesa) {
        clearTimeout(timeoutReconnectVoiceGangDesa);
        timeoutReconnectVoiceGangDesa = null;
    }

    const koneksiVoice = getVoiceConnection(
        konfigurasiVoiceGangDesa.guildId
    );

    if (koneksiVoice) {
        try {
            koneksiVoice.destroy();
        } catch (error) {
            console.error(
                '[VOICE 24/7] Gagal menutup koneksi voice:',
                error
            );
        }
    }

    clientVoiceGangDesa.destroy();
    process.exit(0);
}

process.on('SIGINT', () => hentikanBotVoiceGangDesa('SIGINT'));
process.on('SIGTERM', () => hentikanBotVoiceGangDesa('SIGTERM'));

process.on('unhandledRejection', error => {
    console.error('[VOICE 24/7] Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('[VOICE 24/7] Uncaught exception:', error);
});

const tokenBotGangDesa = process.env.DISCORD_BOT_TOKEN;

if (
    !tokenBotGangDesa ||
    !konfigurasiVoiceGangDesa.guildId ||
    !konfigurasiVoiceGangDesa.voiceChannelId
) {
    console.error(
        '[VOICE 24/7] DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, dan ' +
        'DISCORD_VOICE_CHANNEL_ID wajib diisi.'
    );

    process.exit(1);
}

clientVoiceGangDesa.login(tokenBotGangDesa).catch(error => {
    console.error('[VOICE 24/7] Gagal login:', error);
    process.exit(1);
});