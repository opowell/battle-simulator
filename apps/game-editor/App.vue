<script setup>
import { ref, computed, onMounted } from 'vue';
import TopBar        from './components/TopBar.vue';
import RestartBanner from './components/RestartBanner.vue';
import GamesList     from './components/GamesList.vue';
import DetailHeader  from './components/DetailHeader.vue';
import MetadataForm  from './components/MetadataForm.vue';
import FilesTab      from './components/FilesTab.vue';
import CreateModal   from './components/CreateModal.vue';
import ToastStack    from './components/ToastStack.vue';

const blankMeta = () => ({
  minPlayers: 2, maxPlayers: 2,
  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
});

const games    = ref([]);
const loading  = ref(true);
const saving   = ref(false);
const selected = ref(null);
const tab      = ref('meta');
const form     = ref(blankMeta());

const filePath     = ref(null);
const fileContent  = ref('');
const fileOriginal = ref('');

const creating   = ref(false);
const draft      = ref({ name: '', ...blankMeta() });
const restartMsg = ref('');

const toasts = ref([]);
let toastId = 0;

const current = computed(() => games.value.find(g => g.name === selected.value) || null);
const metaDirty = computed(() =>
  current.value ? JSON.stringify(form.value) !== JSON.stringify(baseline()) : false);
const fileDirty = computed(() => fileContent.value !== fileOriginal.value);

function baseline() {
  const g = current.value;
  return g
    ? { minPlayers: g.minPlayers, maxPlayers: g.maxPlayers, defaultPlayers: g.defaultPlayers.map(p => ({ ...p })) }
    : blankMeta();
}

async function load(selectName) {
  loading.value = true;
  try {
    const { games: list } = await window.editorApi.list();
    games.value = list;
    if (selectName && list.some(g => g.name === selectName)) select(selectName);
    else if (selected.value && !list.some(g => g.name === selected.value)) selected.value = null;
  } catch (e) { toast(e.message, 'err'); }
  loading.value = false;
}

function select(name) {
  selected.value = name;
  form.value = baseline();
  filePath.value = null; fileContent.value = ''; fileOriginal.value = '';
}

async function saveMeta() {
  saving.value = true;
  try {
    await window.editorApi.update(current.value.name, { ...form.value });
    restartMsg.value = 'Metadata saved';
    toast('Saved ' + current.value.name, 'ok');
    await load(current.value.name);
  } catch (e) { toast(e.message, 'err'); }
  saving.value = false;
}

async function openFile(path) {
  if (fileDirty.value && !confirm('Discard unsaved changes to ' + filePath.value + '?')) return;
  try {
    const { content } = await window.editorApi.readFile(current.value.name, path);
    filePath.value = path; fileContent.value = content; fileOriginal.value = content;
  } catch (e) { toast(e.message, 'err'); }
}

async function saveFile() {
  saving.value = true;
  try {
    await window.editorApi.writeFile(current.value.name, filePath.value, fileContent.value);
    fileOriginal.value = fileContent.value;
    toast('Saved ' + filePath.value, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  saving.value = false;
}

function openCreate() {
  draft.value = { name: '', ...blankMeta() };
  creating.value = true;
}

async function createGame() {
  saving.value = true;
  try {
    const res = await window.editorApi.create({ ...draft.value });
    creating.value = false;
    restartMsg.value = 'Game "' + res.name + '" scaffolded';
    toast('Created ' + res.name + ' (' + res.gameClass + ')', 'ok');
    await load(res.name);
  } catch (e) { toast(e.message, 'err'); }
  saving.value = false;
}

async function removeGame() {
  const name = current.value.name;
  if (!confirm('Delete game "' + name + '"? This removes games/' + name + '/ and its registry entry.')) return;
  try {
    await window.editorApi.remove(name);
    restartMsg.value = 'Game "' + name + '" deleted';
    toast('Deleted ' + name, 'ok');
    selected.value = null;
    await load();
  } catch (e) { toast(e.message, 'err'); }
}

function toast(msg, kind) {
  const id = ++toastId;
  toasts.value.push({ id, msg, kind });
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, 4200);
}

onMounted(() => load());
</script>

<template>
  <div class="editor">
    <TopBar :count="games.length"/>
    <RestartBanner :message="restartMsg"/>

    <div class="editor-body">
      <GamesList :games="games" :selected="selected" :loading="loading" @select="select" @create="openCreate"/>

      <div class="panel">
        <template v-if="current">
          <DetailHeader :name="current.name" v-model:tab="tab"
                        :files-count="current.files.length" @delete="removeGame"/>
          <MetadataForm v-if="tab === 'meta'" :form="form" :dirty="metaDirty" :saving="saving"
                        @save="saveMeta" @revert="form = baseline()"/>
          <FilesTab v-else :files="current.files" :file-path="filePath" v-model:content="fileContent"
                    :dirty="fileDirty" :saving="saving" @open="openFile" @save="saveFile"/>
        </template>
        <div v-else class="empty">Select a game on the left, or create a new one.</div>
      </div>
    </div>

    <CreateModal v-if="creating" :draft="draft" :saving="saving"
                 @create="createGame" @cancel="creating = false"/>
    <ToastStack :toasts="toasts"/>
  </div>
</template>
