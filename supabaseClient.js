// Importar el cliente de Supabase desde CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Reemplaza con tus credenciales reales de Supabase
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_ANON_KEY = 'tu-clave-anon-aqui';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);