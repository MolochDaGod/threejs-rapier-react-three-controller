import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { getPost, useListPosts, type Post } from "@workspace/api-client-react";
import type {
  ContentRef,
  PublicRoomInfo,
  RoomMode,
  RoomVisibility,
} from "@workspace/danger-net";
import type { DangerClient } from "../net/DangerClient";
import type { VoxelMap } from "../three/voxel/types";
import type { SceneDescriptor } from "../three/editor/types";
import {
  ROOM_PRESET_LIST,
  ROOM_PRESETS,
  asRoomPresetId,
  loadRoomPreset,
  type RoomPresetId,
} from "../three/RoomPresets";
import { EnvThumb } from "./EnvThumb";

interface Props {
  /** Load a posted voxel map into the editor. */
  onLoad: (map: VoxelMap) => void;
  /** Launch a posted voxel map straight into a play session. */
  onPlay: (map: VoxelMap) => void;
  /** Reopen a posted Scene Editor scene in the Scene Editor. */
  onLoadScene: (scene: SceneDescriptor) => void;
  /** Return to the door select. */
  onExit: () => void;
  /** Enter the persistent GRUDOX island world (harvest/craft/build/combat). */
  onEnterWorld?: () => void;
  /** The shared multiplayer relay client, created in App and reused by Studio. */
  net: DangerClient;
  /**
   * The room was joined/created (server welcome received). The resolved playable
   * map (or null for the built-in arena) is handed up so App can switch into the
   * Danger Room with the right content. The room's chosen environment preset id
   * (when set) travels alongside so every joiner loads the same arena.
   */
  onEnterRoom: (map: VoxelMap | null, preset?: string) => void;
}

/** Best-effort coercion of an opaque post payload into a VoxelMap. */
function asVoxelMap(payload: unknown): VoxelMap | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.blocks)) return null;
  return {
    version: typeof p.version === "number" ? p.version : 1,
    dungeon: !!p.dungeon,
    blocks: p.blocks as VoxelMap["blocks"],
    deployables: Array.isArray(p.deployables) ? (p.deployables as VoxelMap["deployables"]) : [],
  };
}

/** Best-effort coercion of an opaque post payload into a Scene Editor descriptor. */
function asSceneDescriptor(payload: unknown): SceneDescriptor | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.objects)) return null;
  return {
    version: typeof p.version === "number" ? p.version : 1,
    layers: Array.isArray(p.layers) ? (p.layers as SceneDescriptor["layers"]) : [],
    objects: p.objects as SceneDescriptor["objects"],
  };
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * The Lobby: multiplayer Danger Room rooms on top, plus a public gallery of
 * community creations posted from the Voxel and Scene editors. Voxel maps
 * (posted as "dungeon") can be loaded into the editor, played solo, or used as
 * the content for a multiplayer room.
 */
export function Lobby({ onLoad, onPlay, onLoadScene, onExit, onEnterWorld, net, onEnterRoom }: Props) {
  const { user, isSignedIn } = useUser();
  const { data, isLoading, isError, refetch, isFetching } = useListPosts();

  const posts = useMemo<Post[]>(() => data ?? [], [data]);
  // Keep the welcome handler reading the freshest posts without resubscribing.
  const postsRef = useRef<Post[]>(posts);
  postsRef.current = posts;

  const playerName = useMemo(
    () => user?.firstName || user?.username || "Player",
    [user?.firstName, user?.username],
  );

  // Playable dungeon maps usable as room content.
  const dungeonPosts = useMemo(
    () => posts.filter((p) => p.kind === "dungeon" && asVoxelMap(p.payload)),
    [posts],
  );

  // ── Multiplayer room state ─────────────────────────────────────────────────
  const [rooms, setRooms] = useState<PublicRoomInfo[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomMode, setRoomMode] = useState<RoomMode>("coop");
  const [roomVis, setRoomVis] = useState<RoomVisibility>("public");
  const [contentId, setContentId] = useState("arena");
  const [roomPreset, setRoomPreset] = useState<RoomPresetId>(() => loadRoomPreset());
  // Filter the visible room list by training environment ("all" = no filter).
  const [roomFilter, setRoomFilter] = useState<RoomPresetId | "all">("all");
  const [netErr, setNetErr] = useState<string | null>(null);
  const [connected, setConnected] = useState(net.connected);
  const enteredRef = useRef(false);

  /**
   * Resolve the playable map backing a room's content ref and enter, or refuse.
   * A null postId is the built-in arena (enter with no map). For a post-backed
   * room we resolve authoritatively: prefer the loaded gallery list, but if the
   * post isn't loaded yet (e.g. join-by-code before the list arrives) we fetch
   * it by id. If the map still can't be loaded we leave the room and surface an
   * error rather than silently dropping the player into the wrong world.
   */
  const enterWithContent = async (content: ContentRef): Promise<void> => {
    if (content.postId == null) {
      onEnterRoom(null, content.preset);
      return;
    }
    const cached = postsRef.current.find((p) => p.id === content.postId);
    let map = cached ? asVoxelMap(cached.payload) : null;
    if (!map) {
      try {
        const post = await getPost(content.postId);
        map = asVoxelMap(post.payload);
      } catch {
        map = null;
      }
    }
    if (!map) {
      setNetErr("Couldn't load this room's map — please try again.");
      enteredRef.current = false;
      net.leave();
      return;
    }
    onEnterRoom(map, content.preset);
  };

  useEffect(() => {
    net.connect();
    if (net.connected) {
      setConnected(true);
      net.list();
    }
    const offOpen = net.on("open", () => {
      setConnected(true);
      net.list();
    });
    const offClose = net.on("close", () => setConnected(false));
    const offRooms = net.on("rooms", (r) => setRooms(r));
    const offErr = net.on("error", (_code, message) => setNetErr(message));
    const offWelcome = net.on("welcome", (msg) => {
      if (enteredRef.current) return;
      enteredRef.current = true;
      void enterWithContent(msg.content);
    });
    const poll = setInterval(() => {
      if (net.connected) net.list();
    }, 4000);
    return () => {
      offOpen();
      offClose();
      offRooms();
      offErr();
      offWelcome();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, onEnterRoom]);

  const onCreate = () => {
    setNetErr(null);
    const trimmed = roomName.trim();
    let content: ContentRef;
    if (contentId === "arena") {
      content = { kind: "arena", name: trimmed || "Danger Room", preset: roomPreset };
    } else {
      const post = posts.find((p) => String(p.id) === contentId);
      content = { kind: "dungeon", postId: post?.id, name: post?.name, preset: roomPreset };
    }
    net.create({
      player: playerName,
      name: trimmed || content.name || "Danger Room",
      mode: roomMode,
      visibility: roomVis,
      content,
    });
  };

  const onJoinByCode = () => {
    const code = joinCode.trim();
    if (!code) return;
    setNetErr(null);
    net.join(code, playerName);
  };

  const onJoinRoom = (code: string) => {
    setNetErr(null);
    net.join(code, playerName);
  };

  // Rooms narrowed to the chosen environment. "All" shows everything; a specific
  // environment shows only rooms whose preset matches (unknown presets only
  // surface under "All").
  const visibleRooms = useMemo(() => {
    const filtered =
      roomFilter === "all"
        ? rooms
        : rooms.filter((room) => asRoomPresetId(room.content.preset) === roomFilter);
    // Pin the always-on official lobbies to the top of the list.
    return [...filtered].sort((a, b) => Number(b.persistent) - Number(a.persistent));
  }, [rooms, roomFilter]);

  return (
    <div className="lobby">
      <div className="lobby-bar">
        <div className="lobby-title">
          <span className="brand">
            THE<span className="brand-accent">LOBBY</span>
          </span>
          <p className="lobby-sub">
            Persistent island world, multiplayer rooms, or community maps.
          </p>
        </div>
        <div className="lobby-actions">
          {onEnterWorld && (
            <button className="ve-btn ve-play lobby-world-enter" onClick={onEnterWorld}>
              🌍 Enter GRUDOX World
            </button>
          )}
          <button className="ve-btn" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button className="ve-btn" onClick={onExit}>
            ⮐ Back
          </button>
        </div>
      </div>

      {onEnterWorld && (
        <section className="lobby-world-banner">
          <div className="lobby-world-banner-copy">
            <h2>GRUDOX Persistent World</h2>
            <p>
              Play as your real Warlords / GRUDOX character (race kit + equipment). Harvest, craft,
              build, vendors, day/night mobs — and <strong>PvP</strong> with other signed-in heroes.
              <kbd>Q</kbd> swaps harvest ↔ combat.
            </p>
          </div>
          <button type="button" className="ve-btn ve-play" onClick={onEnterWorld}>
            Enter World
          </button>
        </section>
      )}

      {/* ── Multiplayer rooms ─────────────────────────────────────────────── */}
      <section className="rooms">
        <div className="rooms-head">
          <h2 className="rooms-title">Multiplayer Rooms</h2>
          <span className={`rooms-conn ${connected ? "on" : ""}`}>
            {connected ? "● connected" : "○ connecting…"}
          </span>
        </div>

        {netErr && <p className="rooms-err">{netErr}</p>}

        <div className="rooms-controls">
          <div className="rooms-create">
            <input
              className="rooms-input"
              placeholder="Room name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              maxLength={32}
            />
            <select
              className="rooms-select"
              value={roomMode}
              onChange={(e) => setRoomMode(e.target.value as RoomMode)}
            >
              <option value="coop">Co-op</option>
              <option value="pvp">PvP</option>
            </select>
            <select
              className="rooms-select"
              value={roomVis}
              onChange={(e) => setRoomVis(e.target.value as RoomVisibility)}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            <select
              className="rooms-select"
              value={contentId}
              onChange={(e) => setContentId(e.target.value)}
            >
              <option value="arena">Danger Room (arena)</option>
              {dungeonPosts.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="rooms-env" role="radiogroup" aria-label="Training environment">
              {ROOM_PRESET_LIST.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`rooms-env-opt ${roomPreset === preset.id ? "on" : ""}`}
                  role="radio"
                  aria-checked={roomPreset === preset.id}
                  title={preset.blurb}
                  onClick={() => setRoomPreset(preset.id)}
                >
                  <EnvThumb preset={preset} />
                  <span className="rooms-env-name">{preset.name}</span>
                </button>
              ))}
            </div>
            <button className="ve-btn ve-play" onClick={onCreate} disabled={!connected}>
              ＋ Create
            </button>
          </div>

          <div className="rooms-join">
            <input
              className="rooms-input"
              placeholder="Join code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
            <button className="ve-btn" onClick={onJoinByCode} disabled={!connected || !joinCode.trim()}>
              Join
            </button>
          </div>
        </div>

        {rooms.length > 0 && (
          <div className="rooms-filter" role="radiogroup" aria-label="Filter rooms by environment">
            <button
              type="button"
              className={`rooms-filter-opt ${roomFilter === "all" ? "on" : ""}`}
              role="radio"
              aria-checked={roomFilter === "all"}
              onClick={() => setRoomFilter("all")}
            >
              All
            </button>
            {ROOM_PRESET_LIST.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`rooms-filter-opt ${roomFilter === preset.id ? "on" : ""}`}
                role="radio"
                aria-checked={roomFilter === preset.id}
                title={preset.blurb}
                onClick={() => setRoomFilter(preset.id)}
              >
                <EnvThumb preset={preset} />
                <span className="rooms-filter-name">{preset.name}</span>
              </button>
            ))}
          </div>
        )}

        {rooms.length === 0 ? (
          <p className="rooms-empty">No public rooms open — create one above.</p>
        ) : visibleRooms.length === 0 ? (
          <p className="rooms-empty">
            No rooms in this environment — pick another or choose “All”.
          </p>
        ) : (
          <div className="rooms-list">
            {visibleRooms.map((room) => {
              const presetId = asRoomPresetId(room.content.preset);
              const preset = presetId ? ROOM_PRESETS[presetId] : null;
              return (
              <div className="rooms-row" key={room.code}>
                {preset && (
                  <span className="rooms-row-env" title={`${preset.name} — ${preset.blurb}`}>
                    <EnvThumb preset={preset} />
                    <span className="rooms-row-env-name">{preset.name}</span>
                  </span>
                )}
                <div className="rooms-row-main">
                  {room.persistent && (
                    <span className="lobby-badge lobby-badge-official">official</span>
                  )}
                  <span className={`lobby-badge lobby-badge-${room.mode}`}>{room.mode}</span>
                  <span className="rooms-row-name">{room.name}</span>
                  <span className="rooms-row-meta">
                    {room.content.kind} · host {room.hostName}
                  </span>
                </div>
                <div className="rooms-row-actions">
                  <span className="rooms-count">
                    {room.players}/{room.maxPlayers}
                  </span>
                  <button
                    className="ve-btn ve-play"
                    onClick={() => onJoinRoom(room.code)}
                    disabled={!connected || room.players >= room.maxPlayers}
                  >
                    Join
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Community gallery ─────────────────────────────────────────────── */}
      <div className="lobby-bar lobby-bar-sub">
        <div className="lobby-title">
          <span className="brand">
            THE<span className="brand-accent">GALLERY</span>
          </span>
          <p className="lobby-sub">Community maps &amp; scenes — load one and jump in.</p>
        </div>
      </div>

      {!isSignedIn && (
        <p className="lobby-note">Sign in to post your own creations to the gallery.</p>
      )}

      {isLoading && <p className="lobby-empty">Loading the gallery…</p>}
      {isError && (
        <p className="lobby-empty">
          Couldn&apos;t reach the gallery.{" "}
          <button className="lobby-link" onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      )}
      {!isLoading && !isError && posts.length === 0 && (
        <p className="lobby-empty">Nothing posted yet — be the first to share a map!</p>
      )}

      <div className="lobby-grid">
        {posts.map((post) => {
          const map = post.kind === "dungeon" ? asVoxelMap(post.payload) : null;
          const scene = post.kind === "scene" ? asSceneDescriptor(post.payload) : null;
          return (
            <div className="lobby-card" key={post.id}>
              <div className="lobby-card-top">
                <span className={`lobby-badge lobby-badge-${post.kind}`}>{post.kind}</span>
                <span className="lobby-when">{timeAgo(post.createdAt)}</span>
              </div>
              <h3 className="lobby-name">{post.name}</h3>
              <p className="lobby-author">by {post.authorName || "anonymous"}</p>
              <div className="lobby-card-actions">
                {map ? (
                  <>
                    <button className="ve-btn ve-play" onClick={() => onPlay(map)}>
                      ▶ Play
                    </button>
                    <button className="ve-btn" onClick={() => onLoad(map)}>
                      ✎ Load
                    </button>
                  </>
                ) : scene ? (
                  <button className="ve-btn" onClick={() => onLoadScene(scene)}>
                    ✎ Load
                  </button>
                ) : (
                  <span className="lobby-viewonly">Unsupported</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
