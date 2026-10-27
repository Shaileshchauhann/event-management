import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiClient {
  static const defaultBaseUrl =
      String.fromEnvironment('BASE_URL', defaultValue: 'https://21e7v8mq05.execute-api.ap-south-1.amazonaws.com/Prod');

  final String baseUrl;

  ApiClient({String? baseUrl})
      : baseUrl = (baseUrl ?? defaultBaseUrl)
            .replaceAll(RegExp(r'/$'), '');

  Future<dynamic> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse('$baseUrl$path');

    final requestHeaders = <String, String>{
      'Content-Type': 'application/json',
      ...?headers,
    };

    final requestBody = body == null ? null : jsonEncode(body);

    late http.Response response;

    if (method.toUpperCase() == 'GET') {
      response = await http.get(
        uri,
        headers: requestHeaders,
      );
    } else if (method.toUpperCase() == 'POST') {
      response = await http.post(
        uri,
        headers: requestHeaders,
        body: requestBody,
      );
    } else {
      throw UnsupportedError('Unsupported HTTP method: $method');
    }

    dynamic decoded;

    if (response.body.isEmpty) {
      decoded = <String, dynamic>{};
    } else {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = <String, dynamic>{
          'message': 'Server returned an invalid response.',
        };
      }
    }

    if (response.statusCode < 200 ||
        response.statusCode >= 300) {
      final message = decoded is Map &&
              decoded['message'] != null
          ? decoded['message'].toString()
          : 'Request failed (${response.statusCode})';

      throw Exception(message);
    }

    return decoded;
  }
}