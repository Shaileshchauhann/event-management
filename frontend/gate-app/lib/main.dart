import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'services/gate_service.dart';

void main() {
  runApp(const GateApp());
}

class GateApp extends StatelessWidget {
  const GateApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Gate Verify',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff102a43),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor:
            const Color(0xfff4f7fb),
      ),
      home: const GateHome(),
    );
  }
}

class GateHome extends StatefulWidget {
  const GateHome({super.key});

  @override
  State<GateHome> createState() => _GateHomeState();
}

class _GateHomeState extends State<GateHome> {
  final MobileScannerController controller =
      MobileScannerController();

  final TextEditingController gateId =
      TextEditingController(text: 'gate-1');

  final GateService service = GateService();

  Map<String, dynamic>? result;

  String? error;

  bool busy = false;

  Future<void> scanned(
    BarcodeCapture capture,
  ) async {
    if (busy || result != null) {
      return;
    }

    if (capture.barcodes.isEmpty) {
      return;
    }

    final String? token =
        capture.barcodes.first.rawValue;

    if (token == null || token.trim().isEmpty) {
      return;
    }

    setState(() {
      busy = true;
      error = null;
    });

    await controller.stop();

    try {
      final verificationResult =
          await service.verify(
        token,
        gateId.text.trim(),
      );

      if (!mounted) {
        return;
      }

      setState(() {
        result = verificationResult;
      });
    } catch (exception) {
      if (!mounted) {
        return;
      }

      setState(() {
        error = _cleanError(exception);
      });
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
  }

  String _cleanError(Object exception) {
    final message = exception
        .toString()
        .replaceFirst('Bad state: ', '')
        .replaceFirst('StateError: ', '')
        .replaceFirst('Exception: ', '');

    return message.isEmpty
        ? 'Verification failed. Please try again.'
        : message;
  }

  Future<void> scanNext() async {
    if (!mounted) {
      return;
    }

    setState(() {
      result = null;
      error = null;
      busy = false;
    });

    await controller.start();
  }

  @override
  void dispose() {
    controller.dispose();
    gateId.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool valid =
        result?['valid'] == true;

    final dynamic reason =
        result?['reason'];

    final String title = valid
        ? 'VALID TICKET'
        : _reasonTitle(reason);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Gate verification'),
        backgroundColor:
            const Color(0xff102a43),
        foregroundColor: Colors.white,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'GATE KEEPER',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(
                    letterSpacing: 2,
                    color:
                        const Color(0xffe76f51),
                    fontWeight:
                        FontWeight.bold,
                  ),
            ),

            const SizedBox(height: 8),

            Text(
              'Scan ticket QR',
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: gateId,
              enabled: !busy && result == null,
              decoration:
                  const InputDecoration(
                labelText: 'Gate ID',
                hintText: 'Example: gate-1',
                border:
                    OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 18),

            if (result == null)
              _scanner(),

            if (busy) ...[
              const SizedBox(height: 20),
              const Center(
                child: Column(
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 12),
                    Text(
                      'Verifying ticket...',
                      style: TextStyle(
                        fontWeight:
                            FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            if (result != null)
              _resultCard(
                title,
                valid,
              ),

            if (error != null) ...[
              const SizedBox(height: 16),
              _errorCard(),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: scanNext,
                child:
                    const Text('Try again'),
              ),
            ],

            const SizedBox(height: 20),

            const Text(
              'Scan the signed QR code from the attendee ticket email.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.black54,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _scanner() {
    return Column(
      children: [
        ClipRRect(
          borderRadius:
              BorderRadius.circular(18),
          child: SizedBox(
            height: 320,
            child: MobileScanner(
              controller: controller,
              onDetect: scanned,
            ),
          ),
        ),

        const SizedBox(height: 14),

        const Text(
          'Center the signed QR code inside the frame.',
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _resultCard(
    String title,
    bool valid,
  ) {
    final dynamic reason =
        result?['reason'];

    final bool alreadyUsed =
        reason == 'already_used';

    final Color cardColor = valid
        ? const Color(0xffe7f8ef)
        : const Color(0xffffeeee);

    final Color iconColor = valid
        ? const Color(0xff16804f)
        : const Color(0xffb42318);

    final IconData icon =
        valid
            ? Icons.check_circle
            : alreadyUsed
                ? Icons.warning_amber_rounded
                : Icons.cancel;

    return Card(
      color: cardColor,
      child: Padding(
        padding:
            const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(
              icon,
              size: 72,
              color: iconColor,
            ),

            const SizedBox(height: 12),

            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(
                    fontWeight:
                        FontWeight.bold,
                  ),
            ),

            const SizedBox(height: 8),

            Text(
              valid
                  ? 'ENTRY APPROVED'
                  : 'ENTRY DENIED',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight:
                    FontWeight.bold,
                color: iconColor,
              ),
            ),

            if (valid) ...[
              const SizedBox(height: 18),

              _fact(
                'Attendee',
                result?['attendeeName'],
              ),

              _fact(
                'Ticket',
                result?['ticketId'],
              ),

              _fact(
                'Event',
                result?['eventId'],
              ),

              _fact(
                'Status',
                'CHECKED IN',
              ),
            ],

            if (!valid &&
                result?['message'] != null) ...[
              const SizedBox(height: 12),

              Text(
                result!['message']
                    .toString(),
                textAlign:
                    TextAlign.center,
                style:
                    const TextStyle(
                  color:
                      Colors.black54,
                ),
              ),
            ],

            const SizedBox(height: 20),

            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: scanNext,
                child: const Text(
                  'Scan next ticket',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _errorCard() {
    return Card(
      color: const Color(0xffffeeee),
      child: Padding(
        padding:
            const EdgeInsets.all(18),
        child: Column(
          children: [
            const Icon(
              Icons.cloud_off,
              size: 48,
              color:
                  Color(0xffb42318),
            ),

            const SizedBox(height: 10),

            const Text(
              'VERIFICATION FAILED',
              style: TextStyle(
                fontSize: 20,
                fontWeight:
                    FontWeight.bold,
                color:
                    Color(0xffb42318),
              ),
            ),

            const SizedBox(height: 8),

            Text(
              error ??
                  'Unable to verify the ticket.',
              textAlign:
                  TextAlign.center,
              style: const TextStyle(
                color:
                    Color(0xffa61b2b),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _fact(
    String label,
    dynamic value,
  ) {
    final String displayValue =
        value == null ||
                value.toString().isEmpty
            ? '-'
            : value.toString();

    return ListTile(
      dense: true,
      contentPadding:
          EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(
        displayValue,
        style: const TextStyle(
          fontWeight:
              FontWeight.bold,
        ),
      ),
    );
  }

  String _reasonTitle(dynamic reason) {
    switch (reason) {
      case 'already_used':
        return 'ALREADY USED';

      case 'cancelled':
        return 'CANCELLED';

      case 'expired':
        return 'EXPIRED TICKET';

      case 'invalid_token':
        return 'INVALID / EXPIRED TOKEN';

      case 'not_found':
        return 'INVALID QR';

      case 'missing_token':
        return 'INVALID QR';

      default:
        return 'ENTRY DENIED';
    }
  }
}