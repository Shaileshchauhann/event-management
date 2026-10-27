import 'dart:convert';

import 'package:http/http.dart' as http;

class GateService {
  static const String defaultBaseUrl =
      String.fromEnvironment('BASE_URL', defaultValue: 'https://21e7v8mq05.execute-api.ap-south-1.amazonaws.com/Prod');

  static const String gateApiKey =
      String.fromEnvironment('GATE_API_KEY', defaultValue: 'YhYO9U1hhlaTBSqxx271E9C4y99aEnmI72N3HN68');

  final String baseUrl;

  GateService({String? baseUrl})
      : baseUrl = (baseUrl ?? defaultBaseUrl)
            .replaceAll(RegExp(r'/$'), '');

  Future<Map<String, dynamic>> verify(
    String token,
    String gateId,
  ) async {
    if (gateApiKey.isEmpty) {
      throw StateError(
        'Gate verification is not configured.',
      );
    }

    if (token.trim().isEmpty) {
      throw StateError(
        'No QR data was detected.',
      );
    }

    if (gateId.trim().isEmpty) {
      throw StateError(
        'Gate ID is required.',
      );
    }

    final uri = Uri.parse('$baseUrl/verify');

    try {
      final response = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': gateApiKey,
            },
            body: jsonEncode({
              // The QR contains the signed JWT.
              // Do NOT replace this with ticketId.
              'token': token.trim(),
              'gateId': gateId.trim(),
            }),
          )
          .timeout(const Duration(seconds: 15));

      dynamic data;

      if (response.body.isEmpty) {
        data = <String, dynamic>{};
      } else {
        try {
          data = jsonDecode(response.body);
        } catch (_) {
          throw StateError(
            'The verification server returned an invalid response.',
          );
        }
      }

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        String message =
            'Verification request failed (${response.statusCode})';

        if (data is Map && data['message'] != null) {
          message = data['message'].toString();
        }

        throw StateError(message);
      }

      if (data is! Map) {
        throw StateError(
          'Invalid verification response.',
        );
      }

      return Map<String, dynamic>.from(data);
    } on StateError {
      rethrow;
    } on FormatException {
      throw StateError(
        'The verification server returned invalid data.',
      );
    } on Exception catch (e) {
      throw StateError(
        'Unable to contact verification server.',
      );
    }
  }
}