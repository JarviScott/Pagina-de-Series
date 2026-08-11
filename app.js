// ==========================================================================
// CONFIGURACIÓN DE CONEXIÓN CON GOOGLE DRIVE API v3 - APP.JS
// ==========================================================================
const API_KEY = "AIzaSyDMd6xPP46Eo_uUXyNgoRP4w7IEL-TMIlw";
const MAIN_FOLDER_ID = "1t9hjRuINETqATZwONUeQI-msbQTJLiQ3";

// Caché local en memoria para optimizar rendimiento y evitar llamadas repetidas
const apiCache = {
  series: null,
  seasons: {}, // llave: seriesFolderId, valor: arreglo de temporadas
  episodes: {} // llave: seasonFolderId, valor: arreglo de episodios
};

// Arreglo plano de episodios cargados para aplicar búsquedas locales rápidas
let currentEpisodesList = [];

// Referencias a los elementos del DOM
const seriesSelect = document.getElementById("series-select");
const seasonSelect = document.getElementById("season-select");
const episodeSearch = document.getElementById("episode-search");
const episodesListContainer = document.getElementById("episodes-list");
const videoPlayer = document.getElementById("video-player");
const staticScreen = document.getElementById("static-screen");
const staticScreenText = document.getElementById("static-screen-text");
const indicatorPlay = document.getElementById("indicator-play");
const marqueeText = document.getElementById("marquee-text");
const errorScreen = document.getElementById("error-screen");
const errorDetailsText = document.getElementById("error-details-text");

// Referencias de controles de la TV y pantalla completa
const screenWrapper = document.getElementById("screen-wrapper");
const tvPowerBtn = document.getElementById("tv-power");
const tvPrevBtn = document.getElementById("tv-prev");
const tvNextBtn = document.getElementById("tv-next");
const fullscreenBtn = document.getElementById("fullscreen-btn");

// watched list, bandera de restauración y estado de energía
let tvPowerOn = true;
let watchedEpisodes = JSON.parse(localStorage.getItem("retroStream_watched") || "[]");
let playbackPositions = JSON.parse(localStorage.getItem("retroStream_playbackPositions") || "{}");
let restoringState = false; // Bandera para evitar reproducir audio durante auto-carga

// ==========================================================================
// SINTETIZADOR WEB AUDIO (EFECTOS DE SONIDO RETRO 8-BITS)
// ==========================================================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// Sonido Blip (Navegación / Clics sencillos)
function playBlipSound() {
  if (restoringState) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "square"; // Tonalidad de 8 bits arcade
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.08);
    
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {
    console.error("Audio error:", e);
  }
}

// Sonido Coin (Selección de Video / Premium)
function playCoinSound() {
  if (restoringState) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "square";
    // Típico sonido de dos notas de Super Mario
    osc.frequency.setValueAtTime(987.77, now); // Nota B5
    osc.frequency.setValueAtTime(1318.51, now + 0.08); // Nota E6
    
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.setValueAtTime(0.04, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(now + 0.35);
  } catch (e) {
    console.error("Audio error:", e);
  }
}

// Sonido Power (Encendido / Apagado)
function playPowerSound(isOn) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (isOn) {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.25);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(250, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    }
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(now + 0.4);
  } catch (e) {
    console.error("Audio error:", e);
  }
}

// ==========================================================================
// FUNCIONES DEL CICLO DE VIDA E INTEGRACIÓN DE API
// ==========================================================================

// Inicialización del sistema
document.addEventListener("DOMContentLoaded", () => {
  initApp();

  // Pausar y reanudar la animación de la marquesina con javascript para máxima compatibilidad
  const marqueePanel = document.querySelector(".marquee-panel");
  const marqueeContainer = document.getElementById("marquee-container");
  if (marqueePanel && marqueeContainer) {
    marqueePanel.addEventListener("mouseenter", () => {
      marqueeContainer.style.animationPlayState = "paused";
    });
    marqueePanel.addEventListener("mouseleave", () => {
      marqueeContainer.style.animationPlayState = "running";
    });
    marqueePanel.addEventListener("touchstart", () => {
      marqueeContainer.style.animationPlayState = "paused";
    }, { passive: true });
    marqueePanel.addEventListener("touchend", () => {
      marqueeContainer.style.animationPlayState = "running";
    }, { passive: true });
  }
});

/**
 * Inicia la carga del contenido de la app (Series).
 */
async function initApp() {
  try {
    setMarqueeMessage("INICIALIZANDO SISTEMA RETRO... CARGANDO SERIES DESDE EL DISCO...");
    const series = await getSeries();
    populateSeriesDropdown(series);
    
    // Restaurar estado anterior si existe
    await restoreSavedState();
    
    if (!localStorage.getItem("retroStream_lastSeries")) {
      setMarqueeMessage("SISTEMA LISTO. POR FAVOR SELECCIONA UNA SERIE EN EL PANEL.");
    }
  } catch (error) {
    showFatalError("Fallo al inicializar la base de datos de series: " + error.message);
  }
}

/**
 * Carga el último estado guardado del localStorage
 */
async function restoreSavedState() {
  const lastSeries = localStorage.getItem("retroStream_lastSeries");
  const lastSeason = localStorage.getItem("retroStream_lastSeason");
  const lastEpisode = localStorage.getItem("retroStream_lastEpisode");

  if (!lastSeries) return;

  restoringState = true; // Desactivar efectos de sonido durante la auto-carga

  try {
    seriesSelect.value = lastSeries;
    await handleSeriesChange(lastSeries);

    if (lastSeason) {
      seasonSelect.value = lastSeason;
      await handleSeasonChange(lastSeason);

      if (lastEpisode) {
        const card = document.querySelector(`.episode-card[data-id="${lastEpisode}"]`);
        if (card) {
          card.scrollIntoView({ block: "center" });
          selectAndPlayEpisode(lastEpisode, cleanFileName(card.querySelector(".ep-title").textContent), card);
        }
      }
    }
  } catch (e) {
    console.error("Error al restaurar el estado:", e);
  } finally {
    restoringState = false; // Rehabilitar sonidos
  }
}

/**
 * Lógica cuando cambia el dropdown de Series
 */
async function handleSeriesChange(seriesId) {
  // Resetear elementos dependientes y reproductor
  seasonSelect.innerHTML = '<option value="">-- SELECCIONA UNA SERIE --</option>';
  seasonSelect.disabled = true;
  episodeSearch.disabled = true;
  episodeSearch.value = "";
  episodesListContainer.innerHTML = '<div class="empty-state">SELECCIONA UNA SERIE Y TEMPORADA PARA CARGAR EPISODIOS</div>';
  
  const topTitle = document.getElementById("current-episode-title-top");
  if (topTitle) {
    topTitle.textContent = "SIN SEÑAL";
    topTitle.classList.remove("active-playing");
  }
  indicatorPlay.classList.remove("green");
  indicatorPlay.classList.add("red");
  videoPlayer.src = "";
  staticScreenText.innerHTML = "INSERT COIN<br><br>SELECCIONA UN CAPITULO";
  staticScreen.style.opacity = "1";
  staticScreen.style.display = "flex";
  
  if (!seriesId) {
    localStorage.removeItem("retroStream_lastSeries");
    localStorage.removeItem("retroStream_lastSeason");
    localStorage.removeItem("retroStream_lastEpisode");
    return;
  }

  // Guardar en localStorage
  localStorage.setItem("retroStream_lastSeries", seriesId);

  try {
    setMarqueeMessage("LEYENDO TEMPORADAS DISPONIBLES DE LA SERIE...");
    seasonSelect.innerHTML = '<option value="">CARGANDO...</option>';
    
    const seasons = await getSeasons(seriesId);
    
    seasonSelect.innerHTML = '<option value="">-- ELIGE TEMPORADA --</option>';
    if (seasons.length === 0) {
      seasonSelect.innerHTML = '<option value="">SIN TEMPORADAS DISPONIBLES</option>';
      setMarqueeMessage("ERROR: NO SE DETECTARON TEMPORADAS EN LA SERIE.");
      return;
    }

    seasons.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name.toUpperCase();
      seasonSelect.appendChild(option);
    });

    seasonSelect.disabled = false;
    setMarqueeMessage("TEMPORADAS CARGADAS. SELECCIONA UNA TEMPORADA.");
  } catch (error) {
    showFatalError("Fallo al leer las temporadas de la serie: " + error.message);
  }
}

/**
 * Lógica cuando cambia el dropdown de Temporadas
 */
async function handleSeasonChange(seasonId) {
  // Resetear elementos de episodio y reproductor
  episodeSearch.disabled = true;
  episodeSearch.value = "";
  episodesListContainer.innerHTML = '<div class="status-info">CARGANDO CAPITULOS...</div>';

  const topTitle = document.getElementById("current-episode-title-top");
  if (topTitle) {
    topTitle.textContent = "SIN SEÑAL";
    topTitle.classList.remove("active-playing");
  }
  indicatorPlay.classList.remove("green");
  indicatorPlay.classList.add("red");
  videoPlayer.src = "";
  staticScreenText.innerHTML = "INSERT COIN<br><br>SELECCIONA UN CAPITULO";
  staticScreen.style.opacity = "1";
  staticScreen.style.display = "flex";

  if (!seasonId) {
    localStorage.removeItem("retroStream_lastSeason");
    localStorage.removeItem("retroStream_lastEpisode");
    episodesListContainer.innerHTML = '<div class="empty-state">SELECCIONA UNA SERIE Y TEMPORADA PARA CARGAR EPISODIOS</div>';
    return;
  }

  // Guardar en localStorage
  localStorage.setItem("retroStream_lastSeason", seasonId);

  try {
    setMarqueeMessage("CONECTANDO A DRIVE PARA RECUPERAR EPISODIOS...");
    const episodes = await getEpisodes(seasonId);
    
    currentEpisodesList = episodes;
    renderEpisodesList(episodes);

    if (episodes.length > 0) {
      episodeSearch.disabled = false;
      setMarqueeMessage("CARGA COMPLETADA. INSERTA UNA MONEDA Y SELECCIONA EL CAPITULO QUE DESEES VER.");
    } else {
      setMarqueeMessage("LA CARPETA DE ESTA TEMPORADA NO TIENE VIDEOS COMPATIBLES.");
    }
  } catch (error) {
    showFatalError("Fallo al leer los episodios de la temporada: " + error.message);
  }
}

// Vinculación de Eventos en Selectores y Buscador
seriesSelect.addEventListener("change", async (e) => {
  playBlipSound();
  await handleSeriesChange(e.target.value);
});

seasonSelect.addEventListener("change", async (e) => {
  playBlipSound();
  await handleSeasonChange(e.target.value);
});

episodeSearch.addEventListener("focus", () => {
  playBlipSound();
});

// Botón de POWER (Encendido / Apagado)
if (tvPowerBtn) {
  tvPowerBtn.addEventListener("click", () => {
    tvPowerOn = !tvPowerOn;
    
    if (tvPowerOn) {
      // Encender TV
      tvPowerBtn.classList.remove("off");
      playPowerSound(true);
      
      // Restaurar fondo de ruido y estática
      staticScreen.style.backgroundImage = "";
      staticScreen.style.backgroundColor = "";
      
      // Reactivar reproducción del último video si existe
      const lastEpisode = localStorage.getItem("retroStream_lastEpisode");
      if (lastEpisode) {
        const card = document.querySelector(`.episode-card[data-id="${lastEpisode}"]`);
        if (card) {
          const cleanName = cleanFileName(card.querySelector(".ep-title").textContent);
          selectAndPlayEpisode(lastEpisode, cleanName, card);
          return;
        }
      }
      
      // Si no hay video, mostrar estática
      staticScreenText.innerHTML = "INSERT COIN<br><br>SELECCIONA UN CAPITULO";
      staticScreen.style.opacity = "1";
      staticScreen.style.display = "flex";
      indicatorPlay.classList.remove("green");
      indicatorPlay.classList.add("red");
      setMarqueeMessage("TV RETRO ENCENDIDA. INSERTA MONEDA.");
    } else {
      // Apagar TV
      tvPowerBtn.classList.add("off");
      playPowerSound(false);
      
      // Detener video e indicadores
      videoPlayer.src = "";
      indicatorPlay.classList.remove("green", "red");
      
      // Apagar pantalla (negro absoluto, sin ruido)
      staticScreen.style.backgroundImage = "none";
      staticScreen.style.backgroundColor = "#000";
      staticScreenText.innerHTML = "";
      staticScreen.style.opacity = "1";
      staticScreen.style.display = "flex";
      
      const topTitle = document.getElementById("current-episode-title-top");
      if (topTitle) {
        topTitle.textContent = "APAGADO";
        topTitle.classList.remove("active-playing");
      }
      setMarqueeMessage("TV RETRO APAGADA. PRESIONA POWER PARA ENCENDER.");
    }
  });
}

// Botón ANTERIOR (Prev)
if (tvPrevBtn) {
  tvPrevBtn.addEventListener("click", () => {
    if (!tvPowerOn) return;
    playBlipSound();
    
    const activeCard = document.querySelector(".episode-card.active");
    let targetCard = null;
    
    if (activeCard) {
      targetCard = activeCard.previousElementSibling;
    }
    
    // Si no hay tarjeta activa o no hay elemento anterior, vamos al último
    if (!targetCard) {
      const cards = document.querySelectorAll(".episode-card");
      if (cards.length > 0) {
        targetCard = cards[cards.length - 1];
      }
    }
    
    if (targetCard) {
      targetCard.scrollIntoView({ block: "center", behavior: "smooth" });
      targetCard.click();
    }
  });
}

// Botón SIGUIENTE (Next)
if (tvNextBtn) {
  tvNextBtn.addEventListener("click", () => {
    if (!tvPowerOn) return;
    playBlipSound();
    
    const activeCard = document.querySelector(".episode-card.active");
    let targetCard = null;
    
    if (activeCard) {
      targetCard = activeCard.nextElementSibling;
    }
    
    // Si no hay tarjeta activa o no hay elemento siguiente, vamos al primero
    if (!targetCard) {
      targetCard = document.querySelector(".episode-card");
    }
    
    if (targetCard) {
      targetCard.scrollIntoView({ block: "center", behavior: "smooth" });
      targetCard.click();
    }
  });
}

// Botón de PANTALLA COMPLETA directo en el Iframe (Google Drive manda en pantalla completa)
if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    playBlipSound();
    if (videoPlayer) {
      if (videoPlayer.requestFullscreen) {
        videoPlayer.requestFullscreen();
      } else if (videoPlayer.webkitRequestFullscreen) {
        videoPlayer.webkitRequestFullscreen();
      } else if (videoPlayer.msRequestFullscreen) {
        videoPlayer.msRequestFullscreen();
      }
    }
  });
}

// ==========================================================================
// CONSULTAS API GOOGLE DRIVE v3
// ==========================================================================

/**
 * Hace el Fetch a la API de Drive para listar carpetas (Series)
 */
async function getSeries() {
  if (apiCache.series) return apiCache.series;

  const query = `'${MAIN_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=name&key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    apiCache.series = data.files || [];
    return apiCache.series;
  } catch (error) {
    console.error("Error al obtener series:", error);
    throw error;
  }
}

/**
 * Hace el Fetch a la API de Drive para listar subcarpetas de una Serie (Temporadas)
 */
async function getSeasons(seriesId) {
  if (apiCache.seasons[seriesId]) return apiCache.seasons[seriesId];

  const query = `'${seriesId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=name&key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    apiCache.seasons[seriesId] = data.files || [];
    return apiCache.seasons[seriesId];
  } catch (error) {
    console.error(`Error al obtener temporadas para la serie ${seriesId}:`, error);
    throw error;
  }
}

/**
 * Hace el Fetch a la API de Drive para listar videos de una Temporada (Episodios)
 */
async function getEpisodes(seasonId) {
  if (apiCache.episodes[seasonId]) return apiCache.episodes[seasonId];

  const query = `'${seasonId}' in parents and mimeType contains 'video/' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=name&pageSize=1000&key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    apiCache.episodes[seasonId] = data.files || [];
    return apiCache.episodes[seasonId];
  } catch (error) {
    console.error(`Error al obtener episodios para la temporada ${seasonId}:`, error);
    throw error;
  }
}

// ==========================================================================
// CONTROLADORES DE RENDERIZADO Y UI
// ==========================================================================

/**
 * Rellena el select de Series
 */
function populateSeriesDropdown(series) {
  seriesSelect.innerHTML = '<option value="">-- ELIGE UNA SERIE --</option>';
  if (series.length === 0) {
    seriesSelect.innerHTML = '<option value="">NO SE ENCONTRARON SERIES</option>';
    return;
  }
  
  series.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name.toUpperCase();
    seriesSelect.appendChild(option);
  });
  seriesSelect.disabled = false;
}

/**
 * Renderiza las tarjetas de los episodios de forma limpia
 */
function renderEpisodesList(episodes) {
  episodesListContainer.innerHTML = "";

  if (episodes.length === 0) {
    episodesListContainer.innerHTML = '<div class="empty-state">NO HAY EPISODIOS EN ESTA SECCIÓN</div>';
    return;
  }

  episodes.forEach((episode, index) => {
    const cleanName = cleanFileName(episode.name);
    const card = document.createElement("div");
    card.className = "episode-card";
    card.dataset.id = episode.id;
    
    const orderNum = String(index + 1).padStart(2, "0");
    const isWatched = watchedEpisodes.includes(episode.id);
    const watchedText = isWatched ? ' <span class="watched-badge">[VISTO]</span>' : '';
    
    card.innerHTML = `
      <div class="ep-number">EPISODIO ${orderNum}${watchedText}</div>
      <div class="ep-title">${cleanName.toUpperCase()}</div>
    `;

    card.addEventListener("click", () => {
      playCoinSound();
      selectAndPlayEpisode(episode.id, cleanName, card);
    });
    episodesListContainer.appendChild(card);
  });
}

/**
 * Filtra episodios localmente según el texto escrito por el usuario
 */
episodeSearch.addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) {
    renderEpisodesList(currentEpisodesList);
    return;
  }

  const filtered = currentEpisodesList.filter(ep => 
    ep.name.toLowerCase().includes(query)
  );
  renderEpisodesList(filtered);
});

/**
 * Selecciona un episodio, cambia la URL del reproductor, actualiza marquesina y activa estados visuales
 */
function selectAndPlayEpisode(fileId, cleanTitle, selectedCard) {
  if (!tvPowerOn) return; // No reproducir si la TV está apagada

  // Guardar en localStorage
  localStorage.setItem("retroStream_lastEpisode", fileId);

  // Marcar como visto
  if (!watchedEpisodes.includes(fileId)) {
    watchedEpisodes.push(fileId);
    localStorage.setItem("retroStream_watched", JSON.stringify(watchedEpisodes));
    
    if (selectedCard) {
      const numDiv = selectedCard.querySelector(".ep-number");
      if (numDiv && !numDiv.querySelector(".watched-badge")) {
        const span = document.createElement("span");
        span.className = "watched-badge";
        span.textContent = "[VISTO]";
        numDiv.appendChild(span);
      }
    }
  }

  // 1. Quitar la clase activa de todos los episodios anteriores
  document.querySelectorAll(".episode-card").forEach(card => card.classList.remove("active"));
  
  // 2. Activar la tarjeta seleccionada
  if (selectedCard) {
    selectedCard.classList.add("active");
  }

  // 3. Apagar indicador rojo (parpadeo de stand-by) e iniciar verde (activo)
  indicatorPlay.classList.remove("red");
  indicatorPlay.classList.add("green");

  // 4. Mostrar pantalla estática brevemente simulando encendido de TV CRT
  staticScreenText.innerHTML = "CARGANDO SEÑAL...";
  staticScreen.style.opacity = "1";
  staticScreen.style.display = "flex";

  // 5. Configurar el origen del reproductor de video nativo con el flujo directo de Google Drive API
  videoPlayer.src = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;
  
  videoPlayer.oncanplay = () => {
    hideStaticScreen();
  };

  videoPlayer.onerror = () => {
    hideStaticScreen();
    console.error("Error al cargar el video en el reproductor nativo.");
  };

  // Intentar reproducir automáticamente
  const playPromise = videoPlayer.play();
  if (playPromise !== undefined) {
    playPromise.catch(error => {
      console.warn("Autoplay bloqueado:", error);
    });
  }

  // 6. Actualizar marquesina de reproducción y título superior
  const selectedSeriesName = seriesSelect.options[seriesSelect.selectedIndex].text;
  const selectedSeasonName = seasonSelect.options[seasonSelect.selectedIndex].text;
  setMarqueeMessage(`${selectedSeriesName} - ${selectedSeasonName} - ${cleanTitle.toUpperCase()}`);

  const topTitle = document.getElementById("current-episode-title-top");
  if (topTitle) {
    topTitle.textContent = cleanTitle.toUpperCase();
    topTitle.classList.add("active-playing");
  }
}

function hideStaticScreen() {
  setTimeout(() => {
    staticScreen.style.opacity = "0";
    setTimeout(() => {
      staticScreen.style.display = "none";
      staticScreen.style.pointerEvents = "none"; // Desactivar pointer events
    }, 300);
  }, 800);
}

// ==========================================================================
// UTILERÍAS / AUXILIARES
// ==========================================================================

/**
 * Limpia la extensión del nombre de archivo de video (ej. .mp4, .mkv, .avi)
 */
function cleanFileName(name) {
  return name.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|3gp|mpeg|mpg)$/i, '');
}

/**
 * Configura el texto del banner marquesina y reinicia la animación para suavidad
 */
function setMarqueeMessage(message) {
  marqueeText.innerHTML = message;
  const container = document.getElementById("marquee-container");
  
  container.style.animation = 'none';
  container.offsetHeight; /* Trigger reflow */
  container.style.animation = null;
}

/**
 * Despliega la pantalla de error fatal arcade en caso de fallo crítico de la API
 */
function showFatalError(errorText) {
  console.error(errorText);
  errorDetailsText.textContent = `MENSAJE: ${errorText}`;
  errorScreen.style.display = "block";
}

// Registro del Service Worker para soporte PWA (Instalación en pantalla de inicio)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.log('Service Worker registrado con éxito:', reg.scope);
    }).catch(err => {
      console.error('Fallo al registrar el Service Worker:', err);
    });
  });
}
