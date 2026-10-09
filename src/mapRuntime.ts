// MapLibre 6 runs its tile/style work in a separate module worker file. The bundler has to emit it (with the shared chunk it imports)
// and the runtime has to be told where it is; without this the map never gets past "Worker failed to load".
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
