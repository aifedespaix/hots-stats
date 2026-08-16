export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useAuthUser();
  if (!data.value?.user) {
    return navigateTo("/login");
  }
  if (data.value.user.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Accès refusé", fatal: true });
  }
});
