export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useAuthUser();
  if (!data.value?.user) {
    return navigateTo("/login");
  }
});
