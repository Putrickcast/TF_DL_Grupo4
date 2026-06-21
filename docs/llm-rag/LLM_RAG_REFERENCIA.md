# Referencia técnica del módulo LLM/RAG

**Proyecto local:**  
`C:\Users\andre\OneDrive\Documentos\Deep Learning\TF_DL_Grupo4`

**Propósito de este archivo:**  
Servir como referencia para Codex y para el equipo de desarrollo sobre cómo debe comportarse el módulo LLM/chatbot RAG validado en el notebook técnico.

---

## 1. Contexto académico

Este proyecto corresponde al Trabajo Final del curso de Deep Learning. La aplicación multimodal debe integrar tres módulos:

1. **MLP tabular:** predicción de calificación esperada o score tabular del alojamiento.
2. **CNN visual:** evaluación de imágenes del alojamiento.
3. **LLM/chatbot:** consulta en lenguaje natural usando ficha del alojamiento y reseñas.

El presente archivo documenta el componente **LLM/RAG**, que ya fue validado previamente en el notebook:

`TF_Chatbot_RAG_Ollama_v6_eval_automatica.ipynb`

El notebook funciona como evidencia técnica en Python/Jupyter. La demo Angular + Node + Ollama funciona como interfaz visual del módulo.

---

## 2. Decisiones clave del módulo LLM/RAG

### 2.1 Chatbot por alojamiento seleccionado

El chatbot debe responder sobre el **Airbnb actualmente seleccionado**, no sobre todo el portafolio por defecto.

Flujo correcto:

```text
Usuario selecciona un alojamiento
→ Angular envía listingId + pregunta
→ Node busca ese listing
→ Se recupera ficha + reseñas del mismo ID Airbnb
→ Se construye prompt con evidencia
→ Ollama genera respuesta
→ Angular muestra respuesta + fuentes usadas
```

Esta decisión evita mezclar reseñas de distintos alojamientos y mejora la trazabilidad.

---

## 3. Flujo técnico esperado

### 3.1 Frontend Angular

Angular debe enviar al backend:

```json
{
  "listingId": "ID Airbnb seleccionado",
  "question": "pregunta del usuario"
}
```

Endpoint esperado:

```text
POST http://127.0.0.1:8787/api/rag-chat
```

### 3.2 Backend Node.js RAG

El backend debe:

1. Recibir `listingId` y `question`.
2. Buscar el alojamiento en:

```text
public/data/listings.json
```

3. Recuperar evidencia únicamente de ese listing:
   - ficha del anuncio;
   - precio;
   - rating;
   - host;
   - capacidad;
   - habitaciones;
   - camas;
   - baños;
   - reseñas relevantes del mismo `ID Airbnb`.

4. Construir un prompt controlado.
5. Enviar el prompt a Ollama.
6. Devolver respuesta + trazabilidad.

---

## 4. Reglas del prompt RAG

El prompt debe obligar al modelo a:

1. Responder solo con la evidencia recuperada.
2. No inventar datos.
3. Declarar falta de evidencia si corresponde.
4. No mezclar reseñas de otros alojamientos.
5. No usar conocimiento externo.
6. No interpretar IDs, nombres de chunks o números técnicos como datos del alojamiento.
7. No interpretar scores técnicos de recuperación como rating, precio o puntaje del alojamiento.
8. Si la pregunta solicita mejoras y no hay críticas claras en la evidencia, responder que no se identifican mejoras específicas con la información disponible.

---

## 5. Modelo LLM local

El modelo real usado en la demo local es:

```text
llama3.1:8b
```

No debe mostrarse `qwen3.5:9b` en la interfaz si ese modelo no está instalado o no se está usando.

Ollama debe responder en local mediante:

```text
http://127.0.0.1:11434/api/chat
```

o endpoint equivalente configurado en el servidor RAG.

---

## 6. Respuesta esperada del backend

El servidor debe devolver a Angular un objeto con trazabilidad:

```json
{
  "answer": "respuesta generada",
  "facts": "datos de ficha usados",
  "evidence": "reseñas o fragmentos recuperados",
  "mode": "ollama-rag",
  "model": "llama3.1:8b",
  "note": "resumen de recuperación"
}
```

Si Ollama falla, puede activarse fallback extractivo, pero debe quedar claramente indicado:

```text
mode: fallback-extractive
```

o un modo equivalente que no se confunda con `ollama-rag`.

---

## 7. Información visible en la interfaz

En la pestaña o sección del chatbot debe mostrarse claramente:

```text
Respondiendo sobre: [título del alojamiento]
ID Airbnb: [id]
Fuente: ficha del anuncio + reseñas del alojamiento seleccionado
Modo: ollama-rag
Modelo: llama3.1:8b
```

Además, debe existir una sección desplegable de evidencias recuperadas.

---

## 8. Cambio de alojamiento

Si el usuario cambia de alojamiento, la interfaz debe:

1. Limpiar el historial del chat, o
2. Mostrar un mensaje claro:

```text
Contexto actualizado. Ahora estás preguntando sobre: [nuevo alojamiento].
```

Esto evita que respuestas antiguas parezcan referirse al nuevo listing.

---

## 9. Evaluación del módulo LLM/RAG

El notebook `TF_Chatbot_RAG_Ollama_v6_eval_automatica.ipynb` valida el módulo con 8 preguntas funcionales:

1. ¿El departamento es bueno para trabajar remoto?
2. ¿Hay quejas frecuentes en las reseñas?
3. ¿Qué aspectos positivos destacan los huéspedes?
4. ¿El precio parece razonable para lo que ofrece?
5. ¿Qué debería mejorar el host?
6. ¿La ubicación parece ser una fortaleza del listado?
7. ¿El alojamiento parece adecuado para familias o grupos?
8. ¿Conviene administrar este departamento según la ficha y reseñas?

La evaluación automática revisa:

| KPI | Descripción |
|---|---|
| Evidencia correcta | Verifica que existan evidencias recuperadas del listing seleccionado. |
| Respuesta suficiente | Verifica que la respuesta atienda la intención de la pregunta. |
| No alucinación | Verifica que no use datos externos ni scores técnicos como si fueran información del alojamiento. |

---

## 10. Reglas de seguridad contra errores frecuentes

### 10.1 No pasar scores técnicos al LLM

Los scores de recuperación pueden mostrarse en la interfaz solo si están claramente etiquetados como:

```text
score de recuperación
```

Pero no deben enviarse al LLM como parte del contexto principal, porque puede confundirlos con ratings, precios o puntajes del alojamiento.

### 10.2 No mezclar listings

El backend no debe recuperar reseñas de otros alojamientos cuando el usuario pregunta por el alojamiento seleccionado.

### 10.3 Seleccionar fuentes según intención

El RAG no debe forzar siempre ficha + reseñas. Antes de construir el prompt, el backend debe detectar la intención de la pregunta actual, por ejemplo:

- capacidad / huéspedes / familias / grupos;
- precio / valor;
- ubicación;
- limpieza;
- anfitrión;
- trabajo remoto / wifi;
- quejas / problemas;
- mejoras;
- conveniencia comercial.

Con esa intención se seleccionan solo las fuentes útiles:

| Intención | Fuente principal | Fuente complementaria |
|---|---|---|
| Capacidad | Ficha: huéspedes, habitaciones, camas, baños | Reseñas sobre pareja, familia, grupos, comodidad o estadía |
| Limpieza | Reseñas sobre limpieza, orden o higiene | Ficha solo si aporta texto objetivo |
| Anfitrión | Reseñas sobre trato, comunicación o atención | Ficha: host, superhost, tiempo como host |
| Precio | Ficha: precio, rating, amenidades | Reseñas sobre valor, recomendación, comodidad o cumplimiento |
| Ubicación | Ficha: distrito o descripción objetiva | Reseñas sobre zona, cercanía, acceso o restaurantes |
| Quejas/mejoras | Reseñas críticas o debilidades | Ficha solo si contextualiza el problema |
| Conveniencia comercial | Ficha + reseñas | Se permite síntesis general de decisión |

Si una fuente no aporta evidencia útil para la intención, no debe mencionarse artificialmente. Si ninguna fuente alcanza, la respuesta debe indicar:

```text
No hay evidencia suficiente en la ficha o reseñas recuperadas para afirmarlo con seguridad.
```

### 10.4 Separación entre evidencia para LLM y evidencia para UI

La evidencia enviada a Ollama debe contener solo datos reales del alojamiento y texto real de reseñas. No se deben enviar porcentajes de recuperación, scores, similitud ni metadatos técnicos.

Cuando varias reseñas son relevantes para la pregunta, el backend debe enviar también un resumen semántico de patrones detectados, sin scores técnicos. Ese resumen debe ayudar al LLM a responder con frases agregadas como:

```text
Varias reseñas destacan...
Los huéspedes coinciden en...
Se repite como fortaleza...
```

El score de recuperación no debe ser el único criterio para redactar la respuesta. Una reseña con menor score debe considerarse si contiene una frase directamente relacionada con la pregunta. Si solo una reseña aporta evidencia real, la respuesta debe aclarar que la evidencia textual es limitada.

La interfaz sí puede mostrar esos valores para trazabilidad, siempre etiquetados como:

```text
relevancia del recuperador
```

o:

```text
score de recuperación
```

### 10.5 No presentar placeholders como modelos entrenados

Si MLP o CNN todavía están pendientes, la interfaz debe decir:

```text
MLP: pendiente de integración
CNN: pendiente de integración
Fusión multimodal: pendiente o baseline demostrativo
```

No debe afirmarse que un modelo está entrenado si solo existe una regla o placeholder.

---

## 11. Integración multimodal esperada

El módulo LLM/RAG se integrará con:

| Módulo | Función |
|---|---|
| MLP | Predicción tabular de calificación esperada o score tabular. |
| CNN | Evaluación visual de fotos del alojamiento. |
| LLM/RAG | Explicación textual basada en ficha y reseñas. |
| Fusión tardía | Combinación de scores tabular, visual y textual. |
| Orquestación | El LLM explica la recomendación final usando evidencia y scores. |

---

## 12. Comandos esperados del proyecto

Desde:

```powershell
cd "C:\Users\andre\OneDrive\Documentos\Deep Learning\TF_DL_Grupo4"
```

Instalar dependencias:

```powershell
pnpm install
```

Ejecutar backend RAG:

```powershell
pnpm run rag
```

Ejecutar frontend Angular:

```powershell
pnpm start
```

Verificar frontend:

```text
http://127.0.0.1:4200/
```

Verificar API RAG:

```text
http://127.0.0.1:8787/api/health
```

Verificar modelo Ollama:

```powershell
ollama list
```

Si falta el modelo:

```powershell
ollama pull llama3.1:8b
```

---

## 13. Qué debe revisar Codex

Codex debe revisar especialmente:

```text
server/rag-server.mjs
src/app/app.ts
src/app/app.html
public/data/listings.json
```

Y usar este archivo junto con el notebook como referencia:

```text
docs/llm-rag/TF_Chatbot_RAG_Ollama_v6_eval_automatica.ipynb
docs/llm-rag/LLM_RAG_REFERENCIA.md
```

---

## 14. Resultado esperado

La demo debe demostrar que:

1. El usuario selecciona un Airbnb.
2. El chatbot responde sobre ese Airbnb.
3. Se usa evidencia del mismo listing.
4. La respuesta se genera con Ollama local.
5. Se visualizan fuentes usadas.
6. El modo reportado es `ollama-rag`.
7. El modelo reportado es `llama3.1:8b`.
8. La app queda lista para integrar MLP y CNN.
