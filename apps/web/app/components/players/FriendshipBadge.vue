<script setup lang="ts">
import type { PlayerFriendshipStatus } from "@hots-stats/shared-types";

type BadgeStatus = "friends" | "pending_outgoing" | "pending_incoming";
type Variant = "search" | "inline" | "pill";

const props = withDefaults(
  defineProps<{
    status: PlayerFriendshipStatus;
    /** "search" = texte simple, sans icône ni lien (résultats de recherche).
     * "inline" = texte + icône/lien, sans fond (colonne "Compte" d'un tableau).
     * "pill" = badge arrondi avec fond teinté (en-tête de profil). */
    variant?: Variant;
    friendsLabel?: string;
    /** Lien pour status="friends" (ex. /friends/{id}). Pas de lien si omis (variant="search" par ex). */
    friendsTo?: string | null;
    pendingOutgoingLabel?: string;
    pendingIncomingLabel?: string;
    /** Lien pour status="pending_incoming". Pas de lien si null. */
    pendingIncomingTo?: string | null;
    addLabel?: string;
    addButtonSize?: "xs" | "sm";
    addButtonVariant?: "solid" | "soft";
    addLoading?: boolean;
    /** false + status="none" -> affiche "-" au lieu du bouton (ex. compte non lié). */
    canAdd?: boolean;
  }>(),
  {
    variant: "pill",
    friendsLabel: "Ami",
    friendsTo: null,
    pendingOutgoingLabel: "Demande envoyée",
    pendingIncomingLabel: "À répondre",
    pendingIncomingTo: "/friends",
    addLabel: "Ajouter",
    addButtonSize: "xs",
    addButtonVariant: "soft",
    addLoading: false,
    canAdd: true,
  },
);

defineEmits<{ (e: "add"): void }>();

const badgeClass: Record<Variant, Record<BadgeStatus, string>> = {
  search: {
    friends: "shrink-0 text-sm text-success",
    pending_outgoing: "shrink-0 text-sm text-muted",
    pending_incoming: "shrink-0 text-sm text-brand",
  },
  inline: {
    friends: "inline-flex items-center gap-1 text-xs font-medium text-success",
    pending_outgoing: "text-xs text-muted",
    pending_incoming: "text-xs font-medium text-brand",
  },
  pill: {
    friends: "inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success",
    pending_outgoing: "inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs text-muted",
    pending_incoming: "inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1 text-xs font-medium text-brand",
  },
};

const showFriendsIcon = computed(() => props.variant !== "search");
</script>

<template>
  <NuxtLink v-if="status === 'friends' && friendsTo" :to="friendsTo" :class="badgeClass[variant].friends" @click.stop>
    <UIcon v-if="showFriendsIcon" name="i-heroicons-check-badge" class="h-4 w-4" />
    {{ friendsLabel }}
  </NuxtLink>
  <span v-else-if="status === 'friends'" :class="badgeClass[variant].friends">
    <UIcon v-if="showFriendsIcon" name="i-heroicons-check-badge" class="h-4 w-4" />
    {{ friendsLabel }}
  </span>

  <span v-else-if="status === 'pending_outgoing'" :class="badgeClass[variant].pending_outgoing">
    {{ pendingOutgoingLabel }}
  </span>

  <NuxtLink
    v-else-if="status === 'pending_incoming' && pendingIncomingTo"
    :to="pendingIncomingTo"
    :class="badgeClass[variant].pending_incoming"
    @click.stop
  >
    {{ pendingIncomingLabel }}
  </NuxtLink>
  <span v-else-if="status === 'pending_incoming'" :class="badgeClass[variant].pending_incoming">
    {{ pendingIncomingLabel }}
  </span>

  <UButton
    v-else-if="status === 'none' && canAdd"
    :size="addButtonSize"
    :variant="addButtonVariant"
    icon="i-heroicons-user-plus"
    :loading="addLoading"
    @click.stop="$emit('add')"
  >
    {{ addLabel }}
  </UButton>
  <span v-else-if="status === 'none'" class="text-xs text-muted">-</span>
</template>
