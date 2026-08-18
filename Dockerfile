# Alternative deploy route: a plain Web Service (instead of Render's static
# site runtime). Deploy: New -> Web Service -> select repo.
# This is optional — the render.yaml blueprint (static site) is simpler and free.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE 80
