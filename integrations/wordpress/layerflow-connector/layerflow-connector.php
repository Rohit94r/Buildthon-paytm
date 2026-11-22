<?php
/**
 * Plugin Name:       LayerFlow Connector
 * Description:       Connect this WordPress site to LayerFlow AI agents: receive auto-published posts, show AI-collected datasets, and embed the real-time comparison assistant.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            LayerFlow
 * License:           Proprietary
 *
 * Two ways to publish from LayerFlow into WordPress:
 *   A) No plugin: add a "WordPress" connection in LayerFlow with an Application Password (Users → Profile).
 *   B) This plugin: add a "Webhook" connection in LayerFlow pointing to
 *      https://yoursite.com/wp-json/layerflow/v1/publish  with the same secret as Settings → LayerFlow.
 *      Posts are created/updated by LayerFlow slug (idempotent), SEO meta is stored for Yoast/RankMath/AIOSEO.
 *
 * Shortcodes:
 *   [layerflow_assistant dataset="colleges" title="Compare colleges"]   real-time AI comparison chat (inline)
 *   [layerflow_posts limit="5" tag="markets"]                           latest LayerFlow posts (from the public API)
 *   [layerflow_table dataset="colleges" fields="name,city,fees_total,avg_package" sort="nirf_rank:asc" limit="50"]
 */

if (!defined('ABSPATH')) {
    exit;
}

const LAYERFLOW_OPT = 'layerflow_connector';

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

function layerflow_opts(): array
{
    $o = get_option(LAYERFLOW_OPT, []);
    return wp_parse_args(is_array($o) ? $o : [], [
        'api_url'        => '',
        'api_key'        => '',   // server-side key: content:read, datasets:read
        'chat_key'       => '',   // browser-safe key: assistant:chat only
        'webhook_secret' => '',
        'post_status'    => 'publish',
        'author_id'      => 0,
        'category'       => '',
        'color'          => '#2563eb',
    ]);
}

add_action('admin_menu', function () {
    add_options_page('LayerFlow', 'LayerFlow', 'manage_options', 'layerflow', 'layerflow_settings_page');
});

add_action('admin_init', function () {
    register_setting('layerflow', LAYERFLOW_OPT, [
        'type'              => 'array',
        'sanitize_callback' => function ($in) {
            $in = is_array($in) ? $in : [];
            return [
                'api_url'        => esc_url_raw(rtrim($in['api_url'] ?? '', '/')),
                'api_key'        => sanitize_text_field($in['api_key'] ?? ''),
                'chat_key'       => sanitize_text_field($in['chat_key'] ?? ''),
                'webhook_secret' => sanitize_text_field($in['webhook_secret'] ?? ''),
                'post_status'    => in_array($in['post_status'] ?? '', ['publish', 'draft', 'pending'], true) ? $in['post_status'] : 'publish',
                'author_id'      => absint($in['author_id'] ?? 0),
                'category'       => sanitize_text_field($in['category'] ?? ''),
                'color'          => sanitize_hex_color($in['color'] ?? '') ?: '#2563eb',
            ];
        },
    ]);
});

function layerflow_settings_page()
{
    $o = layerflow_opts();
    $hook = esc_url(rest_url('layerflow/v1/publish'));
    ?>
    <div class="wrap">
        <h1>LayerFlow Connector</h1>
        <p>Webhook URL for LayerFlow → Connections → <strong>Webhook</strong>: <code><?php echo $hook; ?></code></p>
        <form method="post" action="options.php">
            <?php settings_fields('layerflow'); ?>
            <table class="form-table" role="presentation">
                <?php
                $rows = [
                    ['api_url', 'LayerFlow URL', 'https://agents.yourdomain.com', 'url'],
                    ['api_key', 'Server API key', 'lf_pk_… (content:read, datasets:read)', 'password'],
                    ['chat_key', 'Assistant key (public)', 'lf_pk_… (assistant:chat only)', 'text'],
                    ['webhook_secret', 'Webhook secret', 'same secret as the LayerFlow webhook connection', 'password'],
                    ['category', 'Default category', 'News', 'text'],
                    ['color', 'Widget colour', '#2563eb', 'text'],
                ];
                foreach ($rows as [$k, $label, $ph, $type]) {
                    printf(
                        '<tr><th scope="row"><label for="lf_%1$s">%2$s</label></th><td><input class="regular-text" id="lf_%1$s" type="%5$s" name="%3$s[%1$s]" value="%4$s" placeholder="%6$s"></td></tr>',
                        esc_attr($k), esc_html($label), esc_attr(LAYERFLOW_OPT), esc_attr($o[$k]), esc_attr($type), esc_attr($ph)
                    );
                }
                ?>
                <tr>
                    <th scope="row">New posts</th>
                    <td>
                        <select name="<?php echo esc_attr(LAYERFLOW_OPT); ?>[post_status]">
                            <?php foreach (['publish' => 'Publish immediately', 'draft' => 'Save as draft', 'pending' => 'Pending review'] as $v => $l) : ?>
                                <option value="<?php echo esc_attr($v); ?>" <?php selected($o['post_status'], $v); ?>><?php echo esc_html($l); ?></option>
                            <?php endforeach; ?>
                        </select>
                        <?php wp_dropdown_users(['name' => LAYERFLOW_OPT . '[author_id]', 'selected' => $o['author_id'], 'show_option_none' => 'Default author', 'option_none_value' => 0]); ?>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/* -------------------------------------------------------------------------- */
/* Webhook receiver: POST /wp-json/layerflow/v1/publish                         */
/* -------------------------------------------------------------------------- */

add_action('rest_api_init', function () {
    register_rest_route('layerflow/v1', '/publish', [
        'methods'             => 'POST',
        'callback'            => 'layerflow_receive',
        'permission_callback' => '__return_true', // authenticated by HMAC signature below
    ]);
});

function layerflow_receive(WP_REST_Request $req)
{
    $o = layerflow_opts();
    if (empty($o['webhook_secret'])) {
        return new WP_Error('layerflow_not_configured', 'Set the webhook secret in Settings → LayerFlow', ['status' => 500]);
    }
    $raw = $req->get_body();
    $sig = (string) $req->get_header('x-layerflow-signature');
    $expected = 'sha256=' . hash_hmac('sha256', $raw, $o['webhook_secret']);
    if (!hash_equals($expected, $sig)) {
        return new WP_Error('layerflow_bad_signature', 'Invalid signature', ['status' => 401]);
    }

    $event = json_decode($raw, true);
    $type = is_array($event) ? ($event['event'] ?? '') : '';
    // "ping" = the Test button in LayerFlow; "message" = notifier digests. Acknowledge, nothing to store.
    if ($type !== 'content.published') {
        return rest_ensure_response(['ok' => true, 'event' => $type, 'ignored' => $type !== 'ping']);
    }
    $c = $event['content'] ?? null;
    if (!is_array($c) || empty($c['slug']) || empty($c['title'])) {
        return new WP_Error('layerflow_bad_payload', 'Missing content', ['status' => 400]);
    }

    // Idempotent: one WordPress post per LayerFlow content id.
    $existing = get_posts([
        'post_type'   => 'post',
        'post_status' => 'any',
        'meta_key'    => '_layerflow_id',
        'meta_value'  => sanitize_text_field($c['id'] ?? $c['slug']),
        'numberposts' => 1,
        'fields'      => 'ids',
    ]);

    $post = [
        'post_title'   => wp_strip_all_tags($c['title']),
        'post_name'    => sanitize_title($c['slug']),
        'post_excerpt' => sanitize_text_field($c['summary'] ?? ''),
        'post_content' => wp_kses_post($c['body_html'] ?? ''),
        'post_status'  => $o['post_status'],
        'post_type'    => 'post',
    ];
    if ($o['author_id']) {
        $post['post_author'] = $o['author_id'];
    }
    if ($existing) {
        $post['ID'] = $existing[0];
        $id = wp_update_post($post, true);
    } else {
        $id = wp_insert_post($post, true);
    }
    if (is_wp_error($id)) {
        return $id;
    }

    update_post_meta($id, '_layerflow_id', sanitize_text_field($c['id'] ?? $c['slug']));
    if (!empty($c['source_url'])) {
        update_post_meta($id, '_layerflow_source_url', esc_url_raw($c['source_url']));
    }
    $tags = array_map('sanitize_text_field', (array) ($c['tags'] ?? []));
    if ($tags) {
        wp_set_post_tags($id, $tags, false);
    }
    if (!empty($o['category'])) {
        $cat = get_cat_ID($o['category']) ?: wp_create_category($o['category']);
        if ($cat) {
            wp_set_post_categories($id, [$cat], false);
        }
    }

    // SEO meta for the common SEO plugins (harmless if they are not installed).
    $seo = $c['seo'] ?? [];
    if (!empty($seo['title_tag'])) {
        foreach (['_yoast_wpseo_title', 'rank_math_title', '_aioseo_title'] as $k) {
            update_post_meta($id, $k, sanitize_text_field($seo['title_tag']));
        }
    }
    if (!empty($seo['meta_description'])) {
        foreach (['_yoast_wpseo_metadesc', 'rank_math_description', '_aioseo_description'] as $k) {
            update_post_meta($id, $k, sanitize_text_field($seo['meta_description']));
        }
    }

    return rest_ensure_response(['ok' => true, 'post_id' => $id, 'url' => get_permalink($id)]);
}

/* -------------------------------------------------------------------------- */
/* Public API helper (server-side, cached)                                     */
/* -------------------------------------------------------------------------- */

function layerflow_get(string $path, int $ttl = 300)
{
    $o = layerflow_opts();
    if (empty($o['api_url']) || empty($o['api_key'])) {
        return null;
    }
    $cache_key = 'lf_' . md5($path);
    $cached = get_transient($cache_key);
    if ($cached !== false) {
        return $cached;
    }
    $res = wp_remote_get($o['api_url'] . '/api/public/v1' . $path, [
        'timeout' => 10,
        'headers' => ['X-API-Key' => $o['api_key'], 'Accept' => 'application/json'],
    ]);
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
        return null;
    }
    $data = json_decode(wp_remote_retrieve_body($res), true);
    set_transient($cache_key, $data, $ttl);
    return $data;
}

/* -------------------------------------------------------------------------- */
/* Shortcodes                                                                  */
/* -------------------------------------------------------------------------- */

add_shortcode('layerflow_assistant', function ($atts) {
    $o = layerflow_opts();
    $a = shortcode_atts(['dataset' => '', 'assistant' => '', 'title' => 'Ask & compare', 'height' => '560'], $atts);
    if (empty($o['api_url']) || empty($o['chat_key'])) {
        return current_user_can('manage_options') ? '<p><em>LayerFlow: set the URL and assistant key in Settings → LayerFlow.</em></p>' : '';
    }
    static $n = 0;
    $n++;
    $id = 'layerflow-assistant-' . $n;
    return sprintf(
        '<div id="%1$s" style="min-height:%2$dpx"></div><script src="%3$s" data-key="%4$s" %5$s data-title="%6$s" data-color="%7$s" data-inline="#%1$s" defer></script>',
        esc_attr($id),
        absint($a['height']),
        esc_url($o['api_url'] . '/widget.js'),
        esc_attr($o['chat_key']),
        $a['assistant'] ? 'data-assistant="' . esc_attr($a['assistant']) . '"' : 'data-dataset="' . esc_attr($a['dataset']) . '"',
        esc_attr($a['title']),
        esc_attr($o['color'])
    );
});

add_shortcode('layerflow_posts', function ($atts) {
    $a = shortcode_atts(['limit' => 5, 'tag' => ''], $atts);
    $q = http_build_query(array_filter(['limit' => absint($a['limit']), 'tag' => $a['tag']]));
    $data = layerflow_get('/content?' . $q);
    if (empty($data['items'])) {
        return '';
    }
    $out = '<ul class="layerflow-posts">';
    foreach ($data['items'] as $p) {
        $out .= sprintf(
            '<li><strong>%s</strong><br><span>%s</span></li>',
            esc_html($p['title']),
            esc_html($p['summary'] ?? '')
        );
    }
    return $out . '</ul>';
});

add_shortcode('layerflow_table', function ($atts) {
    $a = shortcode_atts(['dataset' => '', 'fields' => '', 'sort' => '', 'limit' => 50], $atts);
    if (!$a['dataset']) {
        return '';
    }
    $q = http_build_query(array_filter(['limit' => absint($a['limit']), 'sort' => $a['sort']]));
    $data = layerflow_get('/datasets/' . rawurlencode($a['dataset']) . '/records?' . $q, 600);
    if (empty($data['items'])) {
        return '';
    }
    $labels = [];
    foreach (($data['dataset']['fields'] ?? []) as $f) {
        $labels[$f['key']] = $f['label'];
    }
    $fields = $a['fields'] ? array_map('trim', explode(',', $a['fields'])) : array_keys($labels);
    $out = '<div style="overflow-x:auto"><table class="layerflow-table"><thead><tr>';
    foreach ($fields as $f) {
        $out .= '<th>' . esc_html($labels[$f] ?? $f) . '</th>';
    }
    $out .= '</tr></thead><tbody>';
    foreach ($data['items'] as $r) {
        $out .= '<tr>';
        foreach ($fields as $f) {
            $v = $r['data'][$f] ?? '';
            $out .= '<td>' . esc_html(is_array($v) ? implode(', ', $v) : (string) $v) . '</td>';
        }
        $out .= '</tr>';
    }
    return $out . '</tbody></table></div>';
});
