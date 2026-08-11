<template>
  <div class="min-h-screen bg-background text-foreground font-body">
    <header class="border-b border-border">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <NuxtLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" width="28" height="28" class="h-7 w-7">
          <span class="font-heading text-lg font-semibold tracking-tight">HotS Analytics</span>
        </NuxtLink>
        <UiThemeSwitcher />
      </div>
    </header>
    <main class="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <slot />
    </main>
  </div>
</template>
